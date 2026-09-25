using System;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;

namespace MangaReaderDesktop.Views;

public partial class TranslationOverlayWindow : Window
{
    public TranslationOverlayWindow()
    {
        InitializeComponent();
    }

    /// <summary>Position the overlay over the given physical-pixel region and show it.</summary>
    public void SetRegion(PixelRect region)
    {
        // Position is in physical pixels
        Position = new PixelPoint(region.X, region.Y);

        // Width / Height are in DIPs — divide by screen DPI scale
        var screen  = Screens.ScreenFromPoint(Position) ?? Screens.Primary;
        var scale   = screen?.Scaling ?? 1.0;

        Width  = System.Math.Max(160, region.Width  / scale);
        Height = System.Math.Max(60,  region.Height / scale);
    }

    /// <summary>Update the displayed translation text.</summary>
    public void SetTranslation(string? text)
    {
        TranslationText.Text = text ?? "";
    }

    private void OnHeaderDrag(object? sender, PointerPressedEventArgs e)
    {
        if (e.GetCurrentPoint(this).Properties.IsLeftButtonPressed)
            BeginMoveDrag(e);
    }

    private void OnCloseClick(object? sender, RoutedEventArgs e) => Hide();
}
