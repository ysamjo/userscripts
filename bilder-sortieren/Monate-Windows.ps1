param(
    [string]$TargetFolder
)

$ErrorActionPreference = 'Stop'
$MemeLimit = 500KB
$AnimatedMemeLimit = 1MB
$ImageExtensions = @('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.heic')
$SizeCache = @{}

function Select-TargetFolder {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Ordner mit den zu sortierenden Bildern auswählen'
    $dialog.ShowNewFolderButton = $false

    foreach ($oneDriveRoot in @($env:OneDriveConsumer, $env:OneDrive)) {
        if ($oneDriveRoot -and (Test-Path -LiteralPath $oneDriveRoot)) {
            $dialog.SelectedPath = $oneDriveRoot
            break
        }
    }

    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        return $null
    }
    return $dialog.SelectedPath
}

if (-not $TargetFolder) {
    $TargetFolder = Select-TargetFolder
    if (-not $TargetFolder) {
        Write-Host 'Abgebrochen.'
        exit 0
    }
}

if (-not (Test-Path -LiteralPath $TargetFolder -PathType Container)) {
    throw "Ordner 'Eigene Aufnahmen' nicht gefunden. Starte mit: .\Monate-Windows.ps1 -TargetFolder 'C:\Pfad\Eigene Aufnahmen'"
}

function Get-DateFromFile {
    param([System.IO.FileInfo]$File)

    if ($File.Extension -in @('.jpg', '.jpeg', '.tif', '.tiff')) {
        try {
            Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue
            $image = [System.Drawing.Image]::FromFile($File.FullName)
            try {
                $property = $image.GetPropertyItem(0x9003)
                $value = [Text.Encoding]::ASCII.GetString($property.Value).Trim([char]0)
                return [datetime]::ParseExact($value, 'yyyy:MM:dd HH:mm:ss', $null)
            } finally {
                $image.Dispose()
            }
        } catch {}
    }

    if ($File.BaseName -match '^(?<year>20\d{2})[-._](?<month>\d{2})[-._](?<day>\d{2})') {
        try {
            return [datetime]::new(
                [int]$Matches.year,
                [int]$Matches.month,
                [int]$Matches.day
            )
        } catch {}
    }

    return $File.LastWriteTime
}

function Get-ImageDimensions {
    param([string]$Path)

    try {
        Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue
        $image = [System.Drawing.Image]::FromFile($Path)
        try {
            return @($image.Width, $image.Height)
        } finally {
            $image.Dispose()
        }
    } catch {
        return @(0, 0)
    }
}

function Test-Screenshot {
    param(
        [System.IO.FileInfo]$File,
        [int]$Width,
        [int]$Height
    )

    if ($File.Extension -ieq '.png') { return $true }
    if ($File.Name -match '(?i)screenshot|screen shot|bildschirmfoto') { return $true }
    if ($File.Length -le 1MB -and $Width -ge 700 -and $Height -ge 1600) {
        if (($Height / [double]$Width) -ge 1.7) { return $true }
    }
    return $false
}

function Test-Meme {
    param(
        [System.IO.FileInfo]$File,
        [int]$Width,
        [int]$Height
    )

    if ($File.Name -match '(?i)meme|sticker') { return $true }
    if ($File.Extension -in @('.gif', '.webp') -and $File.Length -le $AnimatedMemeLimit) {
        return $true
    }
    if ($File.Length -gt $MemeLimit) { return $false }
    return $Width -gt 0 -and $Height -gt 0 -and $Width -le 1200 -and $Height -le 1200
}

function Get-SizeSet {
    param([string]$Folder)

    if (-not $SizeCache.ContainsKey($Folder)) {
        $set = [System.Collections.Generic.HashSet[long]]::new()
        if (Test-Path -LiteralPath $Folder) {
            Get-ChildItem -LiteralPath $Folder -File | ForEach-Object {
                [void]$set.Add($_.Length)
            }
        }
        $SizeCache[$Folder] = $set
    }
    return ,$SizeCache[$Folder]
}

function Get-UniquePath {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return $Path }
    $folder = Split-Path -Parent $Path
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($Path)
    $extension = [System.IO.Path]::GetExtension($Path)
    $counter = 1
    do {
        $candidate = Join-Path $folder ("{0} ({1}){2}" -f $stem, $counter, $extension)
        $counter++
    } while (Test-Path -LiteralPath $candidate)
    return $candidate
}

$files = @(Get-ChildItem -LiteralPath $TargetFolder -File)
$moved = 0
$duplicates = 0
$renamed = 0
$errors = 0

foreach ($file in $files) {
    try {
        $width = 0
        $height = 0
        if ($file.Extension.ToLowerInvariant() -in $ImageExtensions -and $file.Length -le 1MB) {
            $dimensions = Get-ImageDimensions -Path $file.FullName
            $width, $height = $dimensions
        }

        if (Test-Screenshot -File $file -Width $width -Height $height) {
            $destinationName = 'Screenshots'
        } elseif (Test-Meme -File $file -Width $width -Height $height) {
            $destinationName = 'Memes'
        } else {
            $date = Get-DateFromFile -File $file
            $destinationName = $date.ToString('yyyy.MM')
        }

        $destinationFolder = Join-Path $TargetFolder $destinationName
        [void](New-Item -ItemType Directory -Path $destinationFolder -Force)
        $sizes = Get-SizeSet -Folder $destinationFolder

        if ($sizes.Contains([long]$file.Length)) {
            Remove-Item -LiteralPath $file.FullName
            $duplicates++
            Write-Host "Duplikat entfernt: $($file.Name)"
            continue
        }

        $destinationPath = Join-Path $destinationFolder $file.Name
        if (Test-Path -LiteralPath $destinationPath) {
            $destinationPath = Get-UniquePath -Path $destinationPath
            $renamed++
        }

        Move-Item -LiteralPath $file.FullName -Destination $destinationPath
        [void]$sizes.Add([long]$file.Length)
        $moved++
        Write-Host "Verschoben: $($file.Name) -> $destinationName"
    } catch {
        $errors++
        Write-Warning "$($file.Name): $($_.Exception.Message)"
    }
}

Write-Host ''
Write-Host "Fertig. Verschoben: $moved | Duplikate entfernt: $duplicates | Umbenannt: $renamed | Fehler: $errors"
Read-Host 'Enter zum Schliessen'
