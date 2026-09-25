using System;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using SkiaSharp;

namespace MangaReaderDesktop.Services;

/// <summary>
/// Cross-platform screen capture. Captures the primary monitor as PNG bytes
/// and provides a crop utility. Linux: X11 P/Invoke. Windows: GDI BitBlt.
/// Pixel conversion uses SkiaSharp (already a transitive Avalonia dependency).
/// </summary>
public sealed class ScreenCaptureService
{
    public async Task<byte[]> CaptureAsync()
    {
        return await Task.Run(() =>
            RuntimeInformation.IsOSPlatform(OSPlatform.Windows)
                ? CaptureWindows()
                : CaptureLinuxX11());
    }

    /// <summary>Crops a PNG and re-encodes it. Coordinates are in screen pixels.</summary>
    public byte[] CropPng(byte[] png, int x, int y, int width, int height)
    {
        using var src = SKBitmap.Decode(png);

        // Clamp to image bounds
        x      = Math.Max(0, Math.Min(x,      src.Width  - 1));
        y      = Math.Max(0, Math.Min(y,      src.Height - 1));
        width  = Math.Max(1, Math.Min(width,  src.Width  - x));
        height = Math.Max(1, Math.Min(height, src.Height - y));

        using var dst    = new SKBitmap(width, height);
        using var canvas = new SKCanvas(dst);
        // Drawing src offset to (-x, -y) makes pixel (x,y) land at canvas origin
        canvas.DrawBitmap(src, -x, -y);
        canvas.Flush();

        using var image = SKImage.FromBitmap(dst);
        using var data  = image.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    }

    // ── Windows ──────────────────────────────────────────────────────────────

    private static byte[] CaptureWindows()
    {
        int w = GetSystemMetrics(SM_CXSCREEN);
        int h = GetSystemMetrics(SM_CYSCREEN);

        nint hScreen = GetDC(0);
        if (hScreen == 0) throw new InvalidOperationException("GetDC failed");

        nint hDC     = 0;
        nint hBitmap = 0;
        nint hOld    = 0;  // declared outside try so finally can restore it
        try
        {
            hDC = CreateCompatibleDC(hScreen);
            if (hDC == 0) throw new InvalidOperationException("CreateCompatibleDC failed");

            hBitmap = CreateCompatibleBitmap(hScreen, w, h);
            if (hBitmap == 0) throw new InvalidOperationException("CreateCompatibleBitmap failed");

            hOld = SelectObject(hDC, hBitmap);
            if (hOld == 0 || hOld == -1)  // NULL or HGDI_ERROR
                throw new InvalidOperationException("SelectObject failed");

            if (!BitBlt(hDC, 0, 0, w, h, hScreen, 0, 0, SRCCOPY))
                throw new InvalidOperationException("BitBlt failed");

            var bi    = new BITMAPINFOHEADER { biSize = 40, biWidth = w, biHeight = -h, biPlanes = 1, biBitCount = 32, biCompression = 0 };
            var bytes = new byte[w * h * 4];
            if (GetDIBits(hDC, hBitmap, 0, (uint)h, bytes, ref bi, DIB_RGB_COLORS) == 0)
                throw new InvalidOperationException("GetDIBits failed");

            return BgraToPng(bytes, w, h);
        }
        finally
        {
            // Reselect original object before deleting hBitmap (must not delete while selected).
            if (hDC != 0 && hOld != 0 && hOld != -1) SelectObject(hDC, hOld);
            if (hBitmap != 0) DeleteObject(hBitmap);
            if (hDC     != 0) DeleteDC(hDC);
            ReleaseDC(0, hScreen);
        }
    }

    // ── Linux X11 ────────────────────────────────────────────────────────────

    private static byte[] CaptureLinuxX11()
    {
        nint display = XOpenDisplay(0);
        if (display == 0) throw new InvalidOperationException("Cannot open X11 display");

        int  screen = XDefaultScreen(display);
        nint root   = XRootWindow(display, screen);

        // Use XDisplayWidth/Height instead of XGetWindowAttributes to avoid
        // struct size mismatch (real XWindowAttributes is ~128 bytes; a smaller
        // struct causes stack corruption → SIGSEGV that bypasses .NET catch).
        int w = XDisplayWidth(display, screen);
        int h = XDisplayHeight(display, screen);

        // ZPixmap=2, AllPlanes=0xFFFFFFFFFFFFFFFF
        nint ximg = XGetImage(display, root, 0, 0, (uint)w, (uint)h, 0xFFFFFFFFFFFFFFFF, 2);
        if (ximg == 0)
        {
            XCloseDisplay(display);
            throw new InvalidOperationException("XGetImage returned null");
        }

        // try/finally opened immediately after XGetImage so PtrToStructure,
        // pixel buffer allocation, and copy are all covered by cleanup.
        try
        {
            // Use a typed struct instead of magic offsets so the fields are
            // always read at the correct platform-specific positions.
            var xi       = Marshal.PtrToStructure<XImage>(ximg);
            nint dataPtr = xi.Data;
            int  bpl     = xi.BytesPerLine;

            // Copy row-by-row to strip any alignment padding X11 adds per scanline.
            int stride = w * 4;
            var pixels = new byte[stride * h];

            if (bpl == stride)
                Marshal.Copy(dataPtr, pixels, 0, pixels.Length);
            else
                for (int row = 0; row < h; row++)
                    Marshal.Copy(dataPtr + row * bpl, pixels, row * stride, stride);

            // X11 ZPixmap delivers BGRA/BGRx 32-bit scanlines.
            // BgraToPng copies into a SkiaSharp buffer so it is safe to call
            // before XDestroyImage releases the X11 pixel memory.
            return BgraToPng(pixels, w, h);
        }
        finally
        {
            XDestroyImage(ximg);
            XCloseDisplay(display);
        }
    }

    // ── Pixel conversion ─────────────────────────────────────────────────────

    /// <summary>Converts a raw BGRA byte array to a PNG-encoded byte array.</summary>
    private static byte[] BgraToPng(byte[] bgraBytes, int w, int h)
    {
        var info = new SKImageInfo(w, h, SKColorType.Bgra8888, SKAlphaType.Premul);
        using var bitmap = new SKBitmap(info);
        Marshal.Copy(bgraBytes, 0, bitmap.GetPixels(), bgraBytes.Length);
        using var image = SKImage.FromBitmap(bitmap);
        using var data  = image.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    }

    // ── X11 P/Invoke ─────────────────────────────────────────────────────────

    /// <summary>
    /// XImage layout on LP64 Linux (64-bit). Field order matches Xlib.h exactly:
    /// width/height (int×2), xoffset/format (int×2), data (ptr), byte_order/
    /// bitmap_unit/bitmap_bit_order/bitmap_pad/depth/bytes_per_line/bits_per_pixel (int×7).
    /// </summary>
    [StructLayout(LayoutKind.Sequential)]
    private struct XImage
    {
        public int  Width;
        public int  Height;
        public int  XOffset;
        public int  Format;
        public nint Data;           // char* — 8 bytes on 64-bit
        public int  ByteOrder;
        public int  BitmapUnit;
        public int  BitmapBitOrder;
        public int  BitmapPad;
        public int  Depth;
        public int  BytesPerLine;
        public int  BitsPerPixel;
    }

    [DllImport("libX11.so.6")] private static extern nint XOpenDisplay(nint displayName);
    [DllImport("libX11.so.6")] private static extern int  XDefaultScreen(nint display);
    [DllImport("libX11.so.6")] private static extern nint XRootWindow(nint display, int screen);
    [DllImport("libX11.so.6")] private static extern int  XDisplayWidth(nint display, int screen);
    [DllImport("libX11.so.6")] private static extern int  XDisplayHeight(nint display, int screen);
    [DllImport("libX11.so.6")] private static extern nint XGetImage(nint display, nint drawable, int x, int y, uint width, uint height, ulong planeMask, int format);
    [DllImport("libX11.so.6")] private static extern void XDestroyImage(nint image);
    [DllImport("libX11.so.6")] private static extern void XCloseDisplay(nint display);

    // ── Windows GDI P/Invoke ─────────────────────────────────────────────────

    const int SM_CXSCREEN    = 0;
    const int SM_CYSCREEN    = 1;
    const int SRCCOPY        = 0x00CC0020;
    const int DIB_RGB_COLORS = 0;

    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAPINFOHEADER { public int biSize, biWidth, biHeight; public short biPlanes, biBitCount; public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant; }

    [DllImport("user32.dll")] private static extern int  GetSystemMetrics(int nIndex);
    [DllImport("user32.dll")] private static extern nint GetDC(nint hwnd);
    [DllImport("user32.dll")] private static extern int  ReleaseDC(nint hwnd, nint hdc);
    [DllImport("gdi32.dll")]  private static extern nint CreateCompatibleDC(nint hdc);
    [DllImport("gdi32.dll")]  private static extern nint CreateCompatibleBitmap(nint hdc, int w, int h);
    [DllImport("gdi32.dll")]  private static extern nint SelectObject(nint hdc, nint hgdiobj);
    [DllImport("gdi32.dll")]  private static extern bool BitBlt(nint hdc, int x, int y, int w, int h, nint hdcSrc, int xs, int ys, int rop);
    [DllImport("gdi32.dll")]  private static extern int  GetDIBits(nint hdc, nint hbmp, uint start, uint lines, byte[] bits, ref BITMAPINFOHEADER bi, int usage);
    [DllImport("gdi32.dll")]  private static extern bool DeleteObject(nint hgdiobj);
    [DllImport("gdi32.dll")]  private static extern bool DeleteDC(nint hdc);
}
