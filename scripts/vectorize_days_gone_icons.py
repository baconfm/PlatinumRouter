from pathlib import Path
from PIL import Image


SOURCES = {
    "collectibles": Path(r"C:\Users\Bacon\Downloads\77ef6c35-df7d-407f-a3be-8741701a0019.png"),
    "injector": Path(r"C:\Users\Bacon\Downloads\5f12cf89-6a27-4e07-8351-64232970154e.png"),
    "cairn": Path(r"C:\Users\Bacon\Downloads\301ccabb-28dd-433a-b2ef-7ab639f9811c.png"),
    "horde": Path(r"C:\Users\Bacon\Downloads\accfe8c9-47cc-4642-b90f-b64e1ed3b36b.png"),
    "camp": Path(r"C:\Users\Bacon\Downloads\599045f7-8702-447b-ba68-9dd582478f2f.png"),
    "ambush": Path(r"C:\Users\Bacon\Downloads\d1b19af6-7abf-41dd-a767-1b3f11cb57f8.png"),
    "ipca": Path(r"C:\Users\Bacon\Downloads\fb00b2d4-b079-416e-a582-58237e8ac98b.png"),
    "infestation": Path(r"C:\Users\Bacon\Downloads\5bcab72a-f8a7-4c44-903b-a99f34ef96c2.png"),
}

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "icons" / "days-gone"
MODULE = ROOT / "js" / "days-gone-traced-icons.js"
GRID = 96


def is_foreground(pixel):
    red, green, blue = pixel[:3]
    brightness = (red + green + blue) / 3
    chroma = max(red, green, blue) - min(red, green, blue)
    return brightness < 218 or chroma > 22


def make_mask(source):
    image = Image.open(source).convert("RGB")
    mask = Image.new("L", image.size)
    mask.putdata([255 if is_foreground(pixel) else 0 for pixel in image.getdata()])
    bounds = mask.getbbox()
    if not bounds:
        raise RuntimeError(f"No foreground found in {source}")
    left, top, right, bottom = bounds
    width = right - left
    height = bottom - top
    pad = max(8, int(max(width, height) * 0.045))
    crop = mask.crop((max(0, left - pad), max(0, top - pad), min(mask.width, right + pad), min(mask.height, bottom + pad)))
    scale = min((GRID - 8) / crop.width, (GRID - 8) / crop.height)
    size = (max(1, round(crop.width * scale)), max(1, round(crop.height * scale)))
    crop = crop.resize(size, Image.Resampling.LANCZOS)
    canvas = Image.new("L", (GRID, GRID))
    canvas.paste(crop, ((GRID - size[0]) // 2, (GRID - size[1]) // 2))
    return canvas.point(lambda value: 255 if value >= 112 else 0)


def mask_to_path(mask):
    pixels = mask.load()
    commands = []
    for y in range(mask.height):
        x = 0
        while x < mask.width:
            if pixels[x, y] == 0:
                x += 1
                continue
            start = x
            while x < mask.width and pixels[x, y] != 0:
                x += 1
            length = x - start
            commands.append(f"M{start} {y}h{length}v1h-{length}z")
    return "".join(commands)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    paths = {}
    for name, source in SOURCES.items():
        path_data = mask_to_path(make_mask(source))
        paths[name] = path_data
        svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">\n' + f'  <path fill="currentColor" d="{path_data}"/>\n</svg>\n'
        (OUTPUT / f"{name}.svg").write_text(svg, encoding="utf-8")
    rows = ["export const DAYS_GONE_TRACED_ICON_BODIES = {"]
    for name, path_data in paths.items():
        rows.append(f'  {name}: `<path fill="currentColor" stroke="none" transform="scale(.25)" d="{path_data}"/>`,')
    rows.extend(["};", ""])
    MODULE.write_text("\n".join(rows), encoding="utf-8")


if __name__ == "__main__":
    main()
