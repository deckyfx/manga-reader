using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MangaReaderDesktop.Models;

// ── /ocr ─────────────────────────────────────────────────────────────────────

public class OcrRequest
{
    [JsonPropertyName("image")] public string Image { get; set; } = "";

    /// <summary>
    /// Whether a translation is wanted. Which engine makes it is the server's business — it is chosen once in
    /// Settings → Translation there, so every client gets the same answer.
    /// </summary>
    [JsonPropertyName("translate")] public bool Translate { get; set; }
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

// ── /api/whoami ───────────────────────────────────────────────────────────────

/// <summary>
/// Who the server thinks we are. /health answers "the server is up" to anyone, so it cannot tell a good key from a
/// bad one; this route can, and answers 401 when the key is missing or refused.
/// </summary>
public class WhoAmIResponse
{
    [JsonPropertyName("username")] public string Username { get; set; } = "";
    [JsonPropertyName("role")] public string Role { get; set; } = "";

    /// <summary>How the request authenticated: "api-key" or "session".</summary>
    [JsonPropertyName("via")] public string Via { get; set; } = "";
}

/// <summary>The server's error body. Every refusal carries one.</summary>
public class ErrorBody
{
    [JsonPropertyName("error")] public string Error { get; set; } = "";
}

// ── /health ───────────────────────────────────────────────────────────────────

/// <summary>
/// A part of the server that has to load before it can be used. The server reports each one as true, false, or the
/// string "disabled" when it was switched off in its settings.
/// </summary>
[JsonConverter(typeof(ComponentStateConverter))]
public enum ComponentState
{
    NotReady,
    Ready,
    Disabled,
}

/// <summary>Reads the server's true / false / "disabled" into <see cref="ComponentState"/>.</summary>
public sealed class ComponentStateConverter : JsonConverter<ComponentState>
{
    public override ComponentState Read(ref Utf8JsonReader reader, System.Type _, JsonSerializerOptions __)
    {
        switch (reader.TokenType)
        {
            case JsonTokenType.True:  return ComponentState.Ready;
            case JsonTokenType.False: return ComponentState.NotReady;
            case JsonTokenType.String when reader.GetString() == "disabled": return ComponentState.Disabled;
            default:
                // Anything else is a server newer than this app, and "not ready" is the safe reading — but a
                // converter must consume exactly one whole value, and an object or an array is more than the one
                // token the reader is sitting on. Leaving the rest would fail the whole payload, which is the very
                // thing that broke Test Connection when `version` grew.
                reader.Skip();
                return ComponentState.NotReady;
        }
    }

    public override void Write(Utf8JsonWriter writer, ComponentState value, JsonSerializerOptions _)
    {
        if (value == ComponentState.Disabled) writer.WriteStringValue("disabled");
        else writer.WriteBooleanValue(value == ComponentState.Ready);
    }
}

/// <summary>What is running over there: the server's own version, the Bun under it, and when it came up.</summary>
public class VersionInfo
{
    [JsonPropertyName("server")] public string Server { get; set; } = "";
    [JsonPropertyName("bun")] public string Bun { get; set; } = "";
    [JsonPropertyName("started_at")] public string StartedAt { get; set; } = "";
}

public class HealthResponse
{
    /// <summary>"starting", "ready" or "degraded".</summary>
    [JsonPropertyName("status")] public string Status { get; set; } = "";

    [JsonPropertyName("ocr")] public bool Ocr { get; set; }
    [JsonPropertyName("translate")] public bool Translate { get; set; }
    [JsonPropertyName("dictionary")] public bool Dictionary { get; set; }
    [JsonPropertyName("inpaint")] public ComponentState Inpaint { get; set; }
    [JsonPropertyName("bubble")] public ComponentState Bubble { get; set; }
    [JsonPropertyName("text_seg")] public ComponentState TextSeg { get; set; }

    /// <summary>What it is downloading right now: label → percent, or -1 when the size isn't known.</summary>
    [JsonPropertyName("downloads")] public Dictionary<string, int> Downloads { get; set; } = [];

    [JsonPropertyName("version")] public VersionInfo Version { get; set; } = new();

    /// <summary>True once the parts this app uses — OCR and the dictionary — will answer.</summary>
    [JsonIgnore]
    public bool UsableHere => Ocr && Dictionary;

    /// <summary>What to tell someone whose request the server is not ready for yet.</summary>
    [JsonIgnore]
    public string NotReadyReason
    {
        get
        {
            var waiting = new List<string>();
            if (!Ocr) waiting.Add("OCR");
            if (!Dictionary) waiting.Add("dictionary");
            if (waiting.Count == 0) return "";
            var what = string.Join(" and ", waiting);
            return Downloads.Count > 0
                ? $"the server is still fetching what it needs ({what})"
                : $"the server is still loading its {what}";
        }
    }
}
