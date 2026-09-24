using System;
using System.Globalization;
using Avalonia.Data.Converters;
using Avalonia.Media;

namespace MangaReaderDesktop.ViewModels;

/// <summary>Returns true when the status is a busy state (capturing / selecting / analyzing).</summary>
public sealed class StatusToBoolConverter : IValueConverter
{
    public static readonly StatusToBoolConverter IsBusy = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is AppStatus s && s is AppStatus.Capturing or AppStatus.Selecting or AppStatus.Analyzing;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>Maps AppStatus to a Catppuccin Mocha foreground brush.</summary>
public sealed class StatusToColorConverter : IValueConverter
{
    public static readonly StatusToColorConverter Instance = new();

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is not AppStatus s) return null;
        return s switch
        {
            AppStatus.Error    => new SolidColorBrush(Color.Parse("#f38ba8")), // red
            AppStatus.Idle     => new SolidColorBrush(Color.Parse("#a6adc8")), // subtext0
            AppStatus.Analyzing => new SolidColorBrush(Color.Parse("#89b4fa")), // blue
            _                  => new SolidColorBrush(Color.Parse("#89dceb")), // sky
        };
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>Returns true when the string is non-empty.</summary>
public sealed class StringNotEmptyConverter : IValueConverter
{
    public static readonly StringNotEmptyConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        !string.IsNullOrEmpty(value as string);

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>Returns true when a long value is non-zero.</summary>
public sealed class NonZeroConverter : IValueConverter
{
    public static readonly NonZeroConverter Instance = new();

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is long l ? l != 0 : value is int i && i != 0;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}
