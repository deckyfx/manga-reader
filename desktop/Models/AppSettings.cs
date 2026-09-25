using System.Text.Json.Serialization;

namespace MangaReaderDesktop.Models;

public record AppSettings
{
    public string ServerUrl { get; init; } = "http://localhost:3579";

    /// <summary>
    /// Not stored in settings.json. Loaded/saved separately by SettingsStore
    /// (DPAPI on Windows, chmod-600 file on Unix).
    /// </summary>
    [JsonIgnore]
    public string? ApiKey { get; init; }

    public string TranslateEngine { get; init; } = "none";
    public string DictionaryMode { get; init; } = "local";
    public int ScanIntervalSeconds { get; init; } = 3;
    public bool ShowOverlay { get; init; } = false;

    /// <summary>"server" (default) or "tesseract" for embedded local OCR.</summary>
    public string OcrMode { get; init; } = "server";

    /// <summary>Tesseract language code, e.g. "jpn", "eng".</summary>
    public string TesseractLang { get; init; } = "jpn";

    /// <summary>"fast" (smaller download) or "best" (higher accuracy).</summary>
    public string TesseractQuality { get; init; } = "fast";
}
