using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.CompilerServices;
using MangaReaderDesktop.Models;
using MangaReaderDesktop.Services;

namespace MangaReaderDesktop.ViewModels;

public class SettingsViewModel : INotifyPropertyChanged
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

    private string _serverUrl           = "http://localhost:3579";
    private string _apiKey              = "";
    private string _translateEngine     = "none";
    private string _dictionaryMode      = "local";
    private double _scanIntervalSeconds = 3;
    private bool   _showOverlay         = false;
    private string _connectionStatus    = "";
    private bool   _isTestingConnection;
    private string _ocrMode             = "server";
    private string _tesseractLang       = "jpn";
    private string _tesseractQuality    = "fast";

    public string ServerUrl
    {
        get => _serverUrl;
        set => SetProperty(ref _serverUrl, value);
    }

    public string ApiKey
    {
        get => _apiKey;
        set => SetProperty(ref _apiKey, value);
    }

    public string TranslateEngine
    {
        get => _translateEngine;
        set => SetProperty(ref _translateEngine, value);
    }

    public string DictionaryMode
    {
        get => _dictionaryMode;
        set => SetProperty(ref _dictionaryMode, value);
    }

    public double ScanIntervalSeconds
    {
        get => _scanIntervalSeconds;
        set
        {
            if (SetProperty(ref _scanIntervalSeconds, value))
                OnPropertyChanged(nameof(ScanIntervalLabel));
        }
    }

    public bool ShowOverlay
    {
        get => _showOverlay;
        set => SetProperty(ref _showOverlay, value);
    }

    public string ConnectionStatus
    {
        get => _connectionStatus;
        set => SetProperty(ref _connectionStatus, value);
    }

    public bool IsTestingConnection
    {
        get => _isTestingConnection;
        set => SetProperty(ref _isTestingConnection, value);
    }

    public string OcrMode
    {
        get => _ocrMode;
        set
        {
            if (SetProperty(ref _ocrMode, value))
            {
                OnPropertyChanged(nameof(IsServerMode));
                OnPropertyChanged(nameof(IsTesseractMode));
            }
        }
    }

    public string TesseractLang
    {
        get => _tesseractLang;
        set
        {
            if (SetProperty(ref _tesseractLang, value))
                OnPropertyChanged(nameof(TesseractModelStatus));
        }
    }

    public string TesseractQuality
    {
        get => _tesseractQuality;
        set
        {
            if (SetProperty(ref _tesseractQuality, value))
                OnPropertyChanged(nameof(TesseractModelStatus));
        }
    }

    public bool IsServerMode    => _ocrMode != "tesseract";
    public bool IsTesseractMode => _ocrMode == "tesseract";

    public string TesseractModelStatus
    {
        get
        {
            if (LocalTesseractService.IsModelReady(_tesseractLang, _tesseractQuality))
                return $"✓  {_tesseractLang} ({_tesseractQuality}) ready";
            return $"Not downloaded — will download on first capture";
        }
    }

    public string ScanIntervalLabel => $"{(int)ScanIntervalSeconds}s";

    public SettingsViewModel() { }

    public SettingsViewModel(AppSettings s)
    {
        _serverUrl           = s.ServerUrl;
        _apiKey              = s.ApiKey ?? "";
        _translateEngine     = s.TranslateEngine;
        _dictionaryMode      = s.DictionaryMode;
        _scanIntervalSeconds = s.ScanIntervalSeconds;
        _showOverlay         = s.ShowOverlay;
        _ocrMode             = s.OcrMode;
        _tesseractLang       = s.TesseractLang;
        _tesseractQuality    = s.TesseractQuality;
    }

    public AppSettings ToSettings()
    {
        if (IsServerMode)
        {
            var url = ServerUrl.Trim();
            if (!Uri.TryCreate(url, UriKind.Absolute, out _))
                throw new ArgumentException($"Invalid server URL: \"{url}\"");
        }

        return new AppSettings
        {
            ServerUrl           = ServerUrl.Trim(),
            ApiKey              = string.IsNullOrWhiteSpace(ApiKey) ? null : ApiKey.Trim(),
            TranslateEngine     = TranslateEngine,
            DictionaryMode      = DictionaryMode,
            ScanIntervalSeconds = Math.Max(1, (int)ScanIntervalSeconds),
            ShowOverlay         = ShowOverlay,
            OcrMode             = OcrMode,
            TesseractLang       = TesseractLang,
            TesseractQuality    = TesseractQuality,
        };
    }
}
