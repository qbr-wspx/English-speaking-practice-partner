from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules


backend_root = Path(SPECPATH)
datas = [(str(backend_root / "app" / "scenarios"), "app/scenarios")]
binaries = []
hiddenimports = collect_submodules("uvicorn") + ["sqlalchemy.dialects.sqlite"]

a = Analysis(
    [str(backend_root / "run_server.py")],
    pathex=[str(backend_root)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["torch", "tensorflow", "matplotlib", "pandas", "numpy", "faster_whisper", "ctranslate2", "av", "tokenizers"],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="CafeLingoBackend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="CafeLingoBackend",
)
