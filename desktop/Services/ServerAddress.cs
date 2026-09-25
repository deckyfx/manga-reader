using System;
using MangaReaderDesktop.Models;

namespace MangaReaderDesktop.Services;

/// <summary>
/// Where the server is, and whether the API key may travel there. The extension's rule
/// (see extension/src/settings-store.ts), and a shade stricter where .NET differs from a browser: a key belongs
/// on the wire only over https, or to an address that is genuinely this machine.
/// </summary>
public static class ServerAddress
{
    /// <summary>True when the address is plain http to somewhere other than this machine.</summary>
    public static bool IsPlainHttpOverNetwork(string? raw)
    {
        if (!Uri.TryCreate(raw?.Trim(), UriKind.Absolute, out var uri)) return false;
        return IsPlainHttpOverNetwork(uri);
    }

    /// <inheritdoc cref="IsPlainHttpOverNetwork(string)"/>
    public static bool IsPlainHttpOverNetwork(Uri uri)
    {
        if (uri.Scheme != Uri.UriSchemeHttp) return false;

        // IsLoopback covers "localhost" itself, 127.0.0.0/8 and ::1 — and nothing else is taken on trust. A name
        // under .localhost is *not* exempt, though RFC 6761 reserves it: Windows and Linux hand those to DNS
        // rather than answering them locally (dotnet/runtime#118569, fixed for .NET 11, and this targets 10), so
        // "anything.localhost" can be made to resolve wherever its DNS says. The extension's rule reads the same
        // but can afford the exemption, because the browser maps *.localhost to loopback before it ever resolves.
        return !uri.IsLoopback;
    }

    /// <summary>
    /// The key to send, which is nothing when it would travel in clear and that has not been allowed. The server
    /// then refuses the request, which is the honest outcome: better a refusal you can read than a credential on
    /// the wire.
    /// </summary>
    public static string? UsableApiKey(AppSettings settings)
    {
        var key = settings.ApiKey?.Trim();
        if (string.IsNullOrWhiteSpace(key)) return null;
        if (IsPlainHttpOverNetwork(settings.ServerUrl) && !settings.AllowInsecureServer) return null;
        return key;
    }

    /// <summary>What to tell someone whose key is being held back.</summary>
    public const string WithheldMessage =
        "The key was not sent: this address is plain http on your network, where anyone on it could read the key. "
        + "Use https, or tick \"Send the key over plain http anyway\" if you trust that network.";
}
