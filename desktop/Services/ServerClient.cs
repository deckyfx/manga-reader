using System;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using MangaReaderDesktop.Models;

namespace MangaReaderDesktop.Services;

/// <summary>Typed HTTP client for the Web-OCR server API.</summary>
public sealed class ServerClient : IDisposable
{
    private readonly HttpClient _http;
    private Uri _baseUri = new("http://localhost:3579");

    public ServerClient(AppSettings settings)
    {
        _http = new HttpClient { Timeout = TimeSpan.FromSeconds(120) };
        ApplySettings(settings);
    }

    private void ApplySettings(AppSettings settings)
    {
        if (Uri.TryCreate(settings.ServerUrl?.Trim(), UriKind.Absolute, out var uri))
            _baseUri = uri;

        _http.DefaultRequestHeaders.Remove("X-Api-Key");
        if (!string.IsNullOrWhiteSpace(settings.ApiKey))
            _http.DefaultRequestHeaders.TryAddWithoutValidation("X-Api-Key", settings.ApiKey);
    }

    public async Task<HealthResponse?> HealthAsync()
    {
        try { return await _http.GetFromJsonAsync<HealthResponse>(new Uri(_baseUri, "/health")); }
        catch { return null; }
    }

    public async Task<OcrResponse> OcrAsync(string base64Image, string translateEngine = "none")
    {
        var req = new OcrRequest { Image = base64Image, TranslateEngine = translateEngine };
        var resp = await _http.PostAsJsonAsync(new Uri(_baseUri, "/ocr"), req);
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<OcrResponse>()
            ?? throw new InvalidOperationException("Empty OCR response");
    }

    public async Task<AnalyzeResponse> AnalyzeAsync(string text, bool sanitize = true, string mode = "local")
    {
        var req = new AnalyzeRequest { Text = text, Sanitize = sanitize, Mode = mode };
        var resp = await _http.PostAsJsonAsync(new Uri(_baseUri, "/analyze"), req);
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<AnalyzeResponse>()
            ?? throw new InvalidOperationException("Empty analyze response");
    }

    public void Reinitialize(AppSettings settings) => ApplySettings(settings);

    public void Dispose() => _http.Dispose();
}
