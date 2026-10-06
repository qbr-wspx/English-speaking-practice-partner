$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$directory = Join-Path $root 'build'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$bitmap = [System.Drawing.Bitmap]::new(256, 256)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)
$brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 22, 124, 180))
$graphics.FillRectangle($brush, 16, 48, 224, 160)
$graphics.FillRectangle($brush, 48, 16, 160, 224)
foreach ($point in @(@(16,16),@(176,16),@(16,176),@(176,176))) { $graphics.FillEllipse($brush, $point[0], $point[1], 64, 64) }
$font = [System.Drawing.Font]::new('Segoe UI', 142, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$format = [System.Drawing.StringFormat]::new()
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$graphics.DrawString('L', $font, [System.Drawing.Brushes]::White, [System.Drawing.RectangleF]::new(0, 2, 256, 256), $format)
$memory = [System.IO.MemoryStream]::new()
$bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
$bytes = $memory.ToArray()
[System.IO.File]::WriteAllBytes((Join-Path $directory 'icon.png'), $bytes)
$stream = [System.IO.File]::Create((Join-Path $directory 'icon.ico'))
$writer = [System.IO.BinaryWriter]::new($stream)
$writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([UInt16]1); $writer.Write([UInt16]32); $writer.Write([UInt32]$bytes.Length); $writer.Write([UInt32]22)
$writer.Write($bytes); $writer.Dispose(); $memory.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $brush.Dispose(); $font.Dispose(); $format.Dispose()
Write-Host 'Generated Lingo Studio application icon.'
