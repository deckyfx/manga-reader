using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace MangaReaderDesktop.Models;

// ── /ocr ─────────────────────────────────────────────────────────────────────

public class OcrRequest
{
    [JsonPropertyName("image")] public string Image { get; set; } = "";
    [JsonPropertyName("translate_engine")] public string TranslateEngine { get; set; } = "none";
}

public class OcrResponse
{
    [JsonPropertyName("text")] public string Text { get; set; } = "";
    [JsonPropertyName("translation")] public string? Translation { get; set; }
    [JsonPropertyName("elapsed_ms")] public long ElapsedMs { get; set; }
}

// ── /analyze ─────────────────────────────────────────────────────────────────

public class AnalyzeRequest
{
    [JsonPropertyName("text")] public string Text { get; set; } = "";
    [JsonPropertyName("sanitize")] public bool Sanitize { get; set; } = true;
    [JsonPropertyName("mode")] public string Mode { get; set; } = "local";
}

public class TokenInfo
{
    [JsonPropertyName("surface")] public string Surface { get; set; } = "";
    [JsonPropertyName("dictionary_form")] public string DictionaryForm { get; set; } = "";
    [JsonPropertyName("reading")] public string Reading { get; set; } = "";
    [JsonPropertyName("pos")] public string Pos { get; set; } = "";
    [JsonPropertyName("pos_detail")] public string PosDetail { get; set; } = "";
    [JsonPropertyName("conjugation_type")] public string ConjugationType { get; set; } = "";
    [JsonPropertyName("conjugation_form")] public string ConjugationForm { get; set; } = "";
    [JsonPropertyName("is_unknown")] public bool IsUnknown { get; set; }
}

public class Definition
{
    [JsonPropertyName("word")] public string Word { get; set; } = "";
    [JsonPropertyName("reading")] public string Reading { get; set; } = "";
    [JsonPropertyName("romaji")] public string Romaji { get; set; } = "";
    [JsonPropertyName("meanings")] public List<string> Meanings { get; set; } = [];
    [JsonPropertyName("jlpt")] public string? Jlpt { get; set; }
    [JsonPropertyName("is_common")] public bool IsCommon { get; set; }
}

public class AnalyzeResponse
{
    [JsonPropertyName("original")] public string Original { get; set; } = "";
    [JsonPropertyName("sanitized")] public string Sanitized { get; set; } = "";
    [JsonPropertyName("sentences")] public List<string> Sentences { get; set; } = [];
    [JsonPropertyName("tokens")] public List<TokenInfo> Tokens { get; set; } = [];
    [JsonPropertyName("definitions")] public List<Definition?> Definitions { get; set; } = [];
    [JsonPropertyName("elapsed_ms")] public long ElapsedMs { get; set; }
}

// ── /health ───────────────────────────────────────────────────────────────────

public class HealthResponse
{
    [JsonPropertyName("status")] public string Status { get; set; } = "";
    [JsonPropertyName("version")] public string Version { get; set; } = "";
    [JsonPropertyName("deepl_available")] public bool DeeplAvailable { get; set; }
}
