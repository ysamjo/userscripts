# PyInstaller-Spezifikation: auf Windows, macOS und Linux jeweils lokal bauen.
from pathlib import Path

app_dir = Path(SPECPATH)
source_root = app_dir.parent

a = Analysis(
    [str(app_dir / "main.py")],
    pathex=[str(app_dir)],
    binaries=[],
    datas=[(str(source_root / "Suchkuerzel-Transfer.command"), ".")],
    hiddenimports=[
        "argparse",
        "contextlib",
        "datetime",
        "hashlib",
        "html",
        "json",
        "os",
        "re",
        "shutil",
        "sqlite3",
        "subprocess",
        "sys",
        "tempfile",
        "time",
        "typing",
        "uuid",
        "xml.etree.ElementTree",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    [],
    name="SuchkuerzelTransfer",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    exclude_binaries=True,
    disable_windowed_traceback=False,
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="SuchkuerzelTransfer")
if __import__("sys").platform == "darwin":
    app = BUNDLE(coll, name="SuchkuerzelTransfer.app", bundle_identifier="de.suchkuerzel.transfer")
