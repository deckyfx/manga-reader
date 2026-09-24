using System;
using System.IO;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Tesseract;

namespace MangaReaderDesktop.Services;

/// <summary>
/// Wraps Tesseract.NET for local (offline) OCR.
/// Downloads language models from tesseract-ocr on GitHub on first use.
/// </summary>
public sealed class LocalTesseractService : IDisposable
{
    private static readonly string DataRoot = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "MangaReader");

    /// <summary>Returns the tessdata directory for a given quality level.</summary>
    public static string TessDataDir(string quality) =>
        Path.Combine(DataRoot, $"tessdata-{quality}");

    /// <summary>Returns true if the traineddata file for lang+quality already exists.</summary>
    public static bool IsModelReady(string lang, string quality) =>
        File.Exists(Path.Combine(TessDataDir(quality), $"{lang}.traineddata"));

    private TesseractEngine? _engine;
    private string? _engineLang;
    private string? _engineQuality;
    private readonly object _lock = new();

    /// <summary>
    /// Downloads the traineddata file for the given language + quality if not present.
    /// Reports progress via <paramref name="progress"/> as (status text, 0-1 fraction).
    /// </summary>
    private static readonly System.Collections.Generic.HashSet<string> AllowedQualities =
        new(System.StringComparer.Ordinal) { "fast", "best" };

    // lang must contain only letters, digits, underscores, or hyphens (no path traversal).
    private static readonly System.Text.RegularExpressions.Regex LangPattern =
        new(@"^[a-zA-Z0-9_\-]{1,64}$", System.Text.RegularExpressions.RegexOptions.Compiled);

    private static void ValidateInputs(string lang, string quality)
    {
        if (!AllowedQualities.Contains(quality))
            throw new ArgumentException($"Invalid quality '{quality}'. Allowed values: fast, best.", nameof(quality));
        if (!LangPattern.IsMatch(lang))
            throw new ArgumentException($"Invalid lang '{lang}'. Only letters, digits, '_' and '-' are allowed.", nameof(lang));
    }

    public static async Task DownloadModelAsync(
        string lang, string quality,
        IProgress<(string status, double pct)>? progress = null,
        CancellationToken ct = default)
    {
        ValidateInputs(lang, quality);

        var dir  = TessDataDir(quality);
        Directory.CreateDirectory(dir);
        var dest = Path.Combine(dir, $"{lang}.traineddata");
        if (File.Exists(dest)) return;

        var repo = quality == "best" ? "tessdata_best" : "tessdata_fast";
        var url  = $"https://raw.githubusercontent.com/tesseract-ocr/{repo}/main/{lang}.traineddata";

        progress?.Report(($"Downloading {lang}.traineddata…", 0));

        using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        using var resp = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        resp.EnsureSuccessStatusCode();

        var   total = resp.Content.Headers.ContentLength ?? -1L;
        var   tmp   = dest + ".download";
        await using (var src = await resp.Content.ReadAsStreamAsync(ct))
        await using (var dst = File.Create(tmp))
        {
            var  buf  = new byte[65536];
            long done = 0;
            int  n;
            while ((n = await src.ReadAsync(buf, ct)) > 0)
            {
                await dst.WriteAsync(buf.AsMemory(0, n), ct);
                done += n;
                if (total > 0)
                    progress?.Report(($"Downloading {lang}.traineddata… {(int)(100.0 * done / total)}%",
                                      (double)done / total));
            }
        }
        File.Move(tmp, dest, overwrite: true);
        progress?.Report(("Model ready.", 1.0));
    }

    /// <summary>
    /// Performs OCR on the given PNG bytes.
    /// Downloads the model automatically if not already present.
    /// </summary>
    public async Task<string> OcrAsync(
        byte[] pngBytes,
        string lang,
        string quality,
        IProgress<(string status, double pct)>? progress = null,
        CancellationToken ct = default)
    {
        await DownloadModelAsync(lang, quality, progress, ct);
        ct.ThrowIfCancellationRequested();

        progress?.Report(("Running OCR…", 1.0));

        return await Task.Run(() =>
        {
            lock (_lock)
            {
                // Re-create engine only when lang or quality changes.
                if (_engine is null || _engineLang != lang || _engineQuality != quality)
                {
                    _engine?.Dispose();
                    _engine        = new TesseractEngine(TessDataDir(quality), lang, EngineMode.Default);
                    _engineLang    = lang;
                    _engineQuality = quality;
                }

                using var pix  = Pix.LoadFromMemory(pngBytes);
                using var page = _engine.Process(pix);
                return page.GetText().Trim();
            }
        }, ct);
    }

    public void Dispose()
    {
        lock (_lock)
        {
            _engine?.Dispose();
            _engine = null;
        }
    }
}
