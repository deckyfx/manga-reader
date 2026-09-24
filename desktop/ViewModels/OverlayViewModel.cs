using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using Avalonia;

namespace MangaReaderDesktop.ViewModels;

public class OverlayViewModel : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged([CallerMemberName] string? name = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));

    private bool SetProperty<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return false;
        field = value;
        OnPropertyChanged(name);
        return true;
    }

    private double _canvasWidth  = 1920;
    private double _canvasHeight = 1080;
    private double _screenScale  = 1.0;
    private Point  _selectionStart;
    private Point  _selectionEnd;
    private bool   _isSelecting;

    public double CanvasWidth  { get => _canvasWidth;  set => SetProperty(ref _canvasWidth,  value); }
    public double CanvasHeight { get => _canvasHeight; set => SetProperty(ref _canvasHeight, value); }
    /// <summary>Physical pixels per DIP (e.g. 1.5 at 150 % DPI). Used for dimension label.</summary>
    public double ScreenScale  { get => _screenScale;  set => SetProperty(ref _screenScale,  value); }
    public bool   IsSelecting  { get => _isSelecting;  set => SetProperty(ref _isSelecting,  value); }

    public Point SelectionStart
    {
        get => _selectionStart;
        set { if (SetProperty(ref _selectionStart, value)) OnPropertyChanged(nameof(SelectionRect)); }
    }

    public Point SelectionEnd
    {
        get => _selectionEnd;
        set { if (SetProperty(ref _selectionEnd, value)) OnPropertyChanged(nameof(SelectionRect)); }
    }

    public Rect SelectionRect
    {
        get
        {
            double x = Math.Min(SelectionStart.X, SelectionEnd.X);
            double y = Math.Min(SelectionStart.Y, SelectionEnd.Y);
            double w = Math.Abs(SelectionEnd.X - SelectionStart.X);
            double h = Math.Abs(SelectionEnd.Y - SelectionStart.Y);
            return new Rect(x, y, w, h);
        }
    }

    public string DimensionLabel =>
        IsSelecting && SelectionRect.Width > 4 && SelectionRect.Height > 4
            ? $"{(int)(SelectionRect.Width * _screenScale)}×{(int)(SelectionRect.Height * _screenScale)}"
            : "";

    public bool HasValidSelection => SelectionRect.Width > 4 && SelectionRect.Height > 4;

    public void BeginSelection(Point pt)
    {
        SelectionStart = pt;
        SelectionEnd   = pt;
        IsSelecting    = true;
    }

    public void UpdateSelection(Point pt)
    {
        SelectionEnd = pt;
        OnPropertyChanged(nameof(DimensionLabel));
    }

    public void EndSelection(Point pt)
    {
        SelectionEnd = pt;
        IsSelecting  = false;
        OnPropertyChanged(nameof(DimensionLabel));
    }

    public void Reset()
    {
        SelectionStart = default;
        SelectionEnd   = default;
        IsSelecting    = false;
        OnPropertyChanged(nameof(DimensionLabel));
    }
}
