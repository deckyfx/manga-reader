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

    /// <summary>
    /// Whether to ask for a translation. Which engine makes it is the server's to decide (Settings → Translation
    /// there), so this is a yes or no — it used to name an engine, and <see cref="LegacyTranslateEngine"/> keeps
    /// a file written by that version meaning what it meant.
    /// </summary>
    public bool Translate { get; init; }

    /// <summary>What older versions stored in place of <see cref="Translate"/>: "none", "local" or "deepl".</summary>
    [JsonPropertyName("TranslateEngine")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? LegacyTranslateEngine { get; init; }

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
