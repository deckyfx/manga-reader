using System;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading;
using System.Threading.Tasks;
using MangaReaderDesktop.Models;

namespace MangaReaderDesktop.Services;

/// <summary>
/// A refusal from the server, in words worth showing someone. The server sends a reason with every refusal; this
/// carries that reason rather than the status line, which says nothing a person can act on.
/// </summary>
public sealed class ServerException : Exception
{
    public HttpStatusCode StatusCode { get; }

    /// <summary>True when the server would not say who we are: no key, or one it does not accept.</summary>
    public bool IsAuthFailure => StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden;

    /// <summary>True when the server is up but not ready for this yet — a model still loading, usually.</summary>
    public bool IsNotReady => StatusCode == HttpStatusCode.ServiceUnavailable;

    public ServerException(HttpStatusCode status, string message) : base(message) => StatusCode = status;
}

/// <summary>Typed HTTP client for the Manga Reader server API.</summary>
public sealed class ServerClient : IDisposable
{
    private readonly HttpClient _http;
    private Uri _baseUri = new("http://localhost:3579");

    /// <summary>True when a key is held but the address is one it may not travel to.</summary>
    private bool _keyWithheld;

    /// <summary>Set when a refusal is best explained by the key having been held back.</summary>
    private string? WithheldNote => _keyWithheld ? ServerAddress.WithheldMessage : null;

    public ServerClient(AppSettings settings)
    {
        // Redirects are not followed: .NET strips Authorization when a redirect crosses origin, but keeps other
        // headers — so a server that answered 302 could walk X-Api-Key to somewhere else entirely.
        _http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })
        {
            Timeout = TimeSpan.FromSeconds(120),
        };
        ApplySettings(settings);
    }

    private void ApplySettings(AppSettings settings)
    {
        if (Uri.TryCreate(settings.ServerUrl?.Trim(), UriKind.Absolute, out var uri))
            _baseUri = uri;

        var key = ServerAddress.UsableApiKey(settings);
        _keyWithheld = key is null && !string.IsNullOrWhiteSpace(settings.ApiKey);

        _http.DefaultRequestHeaders.Remove("X-Api-Key");
        if (key is not null)
            _http.DefaultRequestHeaders.TryAddWithoutValidation("X-Api-Key", key);
    }

    public async Task<HealthResponse?> HealthAsync()
    {
        try { return await _http.GetFromJsonAsync<HealthResponse>(new Uri(_baseUri, "/health")); }
        catch { return null; }
    }

    /// <summary>
    /// Asks the server who this key belongs to. /health answers to anyone, so it is this that tells a good key from
    /// a bad one. Throws <see cref="ServerException"/> when the key is missing or refused.
    /// </summary>
    public async Task<WhoAmIResponse> WhoAmIAsync(CancellationToken ct = default)
    {
        var resp = await _http.GetAsync(new Uri(_baseUri, "/api/whoami"), ct);
        await ThrowIfRefused(resp, ct);
        return await resp.Content.ReadFromJsonAsync<WhoAmIResponse>(ct)
            ?? throw new InvalidOperationException("Empty whoami response");
    }

    public async Task<OcrResponse> OcrAsync(string base64Image, bool translate = false)
    {
        var req = new OcrRequest { Image = base64Image, Translate = translate };
        var resp = await _http.PostAsJsonAsync(new Uri(_baseUri, "/ocr"), req);
        await ThrowIfRefused(resp);
        return await resp.Content.ReadFromJsonAsync<OcrResponse>()
            ?? throw new InvalidOperationException("Empty OCR response");
    }

    public async Task<AnalyzeResponse> AnalyzeAsync(string text, bool sanitize = true, string mode = "local")
    {
        var req = new AnalyzeRequest { Text = text, Sanitize = sanitize, Mode = mode };
        var resp = await _http.PostAsJsonAsync(new Uri(_baseUri, "/analyze"), req);
        await ThrowIfRefused(resp);
        return await resp.Content.ReadFromJsonAsync<AnalyzeResponse>()
            ?? throw new InvalidOperationException("Empty analyze response");
    }

    /// <summary>
    /// Turns a refused response into a <see cref="ServerException"/> carrying what the server said. OCR and analyze
    /// need a contributor's key, so a desktop without one gets 401 here rather than at some later, stranger point.
    /// </summary>
    private async Task ThrowIfRefused(HttpResponseMessage resp, CancellationToken ct = default)
    {
        if (resp.IsSuccessStatusCode) return;

        string? said = null;
        try { said = (await resp.Content.ReadFromJsonAsync<ErrorBody>(ct))?.Error; }
        catch { /* not every refusal comes from the app — a proxy in the way, say */ }

        // A redirect is not followed, so say so rather than reporting it as a refusal nobody can act on.
        if ((int)resp.StatusCode is >= 300 and < 400)
            throw new ServerException(resp.StatusCode,
                $"The server redirected to {resp.Headers.Location?.ToString() ?? "somewhere else"}. "
                + "That is not followed, because the API key would travel with it — point the app at the real address.");

        var message = resp.StatusCode switch
        {
            HttpStatusCode.Unauthorized when WithheldNote is not null => WithheldNote,
            HttpStatusCode.Unauthorized => "The server did not accept this API key. Make one at /user → API keys.",
            HttpStatusCode.Forbidden    => said is { Length: > 0 } f ? f
                : "This account may not do that — OCR needs the contributor role.",
            _ => said is { Length: > 0 } s ? s : $"The server refused: {(int)resp.StatusCode} {resp.ReasonPhrase}",
        };

        throw new ServerException(resp.StatusCode, message);
    }

    public void Reinitialize(AppSettings settings) => ApplySettings(settings);

    public void Dispose() => _http.Dispose();
}
