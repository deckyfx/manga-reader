using System.Collections.Generic;

namespace MangaReaderDesktop.Models;

/// <summary>Pairs a TokenInfo with its optional Definition for display in a TokenCard.</summary>
public sealed class TokenCardModel
{
    public TokenInfo   Token      { get; }
    public Definition? Definition { get; }

    public bool                 HasDefinition => Definition is not null;
    public string               JlptText      => Definition?.Jlpt ?? "";
    public bool                 HasJlpt       => !string.IsNullOrEmpty(Definition?.Jlpt);
    public IReadOnlyList<string> Meanings     => Definition?.Meanings ?? [];

    public TokenCardModel(TokenInfo token, Definition? definition)
    {
        Token      = token;
        Definition = definition;
    }
}
