"""
The Aura droplet, rebuilt from the brand artwork.

One calligraphic gesture: a blunt tail under the bowl, sweeping left and up the
long left side to a sharp apex, then falling down the right and curling inward
into a hook. The opening at the lower right is the character of the mark — a
closed teardrop is the thing it must not become.

Built as two ribbons that both taper to nothing at the apex, so the point is a
real point. Offsetting one continuous centreline through a corner that sharp
folds the outline over itself and grows a blob there instead.
"""
import math

APEX = (48.0, 5.0)

# tail -> apex, and its half-width at each knot
LEFT = [(63.0, 96.0), (45.0, 102.5), (32.5, 101.5), (21.0, 95.5), (12.5, 85.5),
        (8.5, 72.5), (10.5, 59.5), (16.5, 46.0), (25.5, 32.0), (36.0, 18.5), APEX]
LEFT_W = [3.0, 3.4, 4.0, 4.3, 4.4, 4.3, 4.1, 3.8, 3.3, 2.2, 0.0]

# apex -> hook tip
RIGHT = [APEX, (57.0, 17.0), (67.0, 31.0), (77.0, 46.0), (85.0, 61.0),
         (89.5, 73.0), (88.0, 82.0), (81.5, 87.5), (72.5, 86.0)]
RIGHT_W = [0.0, 1.9, 3.0, 3.8, 4.2, 4.3, 3.9, 2.8, 0.5]


def catmull(pts, per_span=30):
    p = [pts[0]] + list(pts) + [pts[-1]]
    out = []
    for i in range(len(p) - 3):
        p0, p1, p2, p3 = p[i], p[i + 1], p[i + 2], p[i + 3]
        for s in range(per_span):
            t = s / per_span
            t2, t3 = t * t, t * t * t
            out.append((
                0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t +
                       (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
                       (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
                0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t +
                       (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
                       (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
            ))
    out.append(pts[-1])
    return out


def widths(curve, half):
    cum = [0.0]
    for i in range(1, len(curve)):
        cum.append(cum[-1] + math.dist(curve[i - 1], curve[i]))
    total = cum[-1] or 1.0
    at = [i / (len(half) - 1) * total for i in range(len(half))]
    out = []
    for d in cum:
        k = min(range(len(at) - 1), key=lambda k: abs(d - at[k]) if at[k] <= d else 1e9)
        for k in range(len(at) - 1):
            if at[k] <= d <= at[k + 1]:
                span = at[k + 1] - at[k]
                u = 0 if span == 0 else (d - at[k]) / span
                u = u * u * (3 - 2 * u)          # ease, so the taper has no kink
                out.append(half[k] * (1 - u) + half[k + 1] * u)
                break
        else:
            out.append(half[-1])
    return out


def ribbon(knots, half):
    curve = catmull(knots)
    w = widths(curve, half)
    left, right = [], []
    for i, (x, y) in enumerate(curve):
        a, b = curve[max(0, i - 1)], curve[min(len(curve) - 1, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        n = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / n, dx / n
        left.append((x + nx * w[i], y + ny * w[i]))
        right.append((x - nx * w[i], y - ny * w[i]))
    return left + right[::-1]


def to_path(poly):
    return "M " + " L ".join(f"{x:.2f} {y:.2f}" for x, y in poly) + " Z"


polys = [ribbon(LEFT, LEFT_W), ribbon(RIGHT, RIGHT_W)]

# Fit into the 100 x 106 box the rest of the brand assets already use, so every
# file that embeds this path keeps its viewBox.
BOX_W, BOX_H, PAD = 100.0, 106.0, 3.0
xs = [x for poly in polys for x, _ in poly]
ys = [y for poly in polys for _, y in poly]
scale = min((BOX_W - 2 * PAD) / (max(xs) - min(xs)), (BOX_H - 2 * PAD) / (max(ys) - min(ys)))
ox = (BOX_W - (max(xs) - min(xs)) * scale) / 2 - min(xs) * scale
oy = (BOX_H - (max(ys) - min(ys)) * scale) / 2 - min(ys) * scale
polys = [[(x * scale + ox, y * scale + oy) for x, y in poly] for poly in polys]

MARK_D = " ".join(to_path(poly) for poly in polys)
open("/tmp/claude-0/-home-user-Abdullah-Ramadan/5fcd0fa8-a5cd-52a2-b1af-f3b2fc975f26/scratchpad/mark.d", "w").write(MARK_D)

xs = [x for poly in polys for x, _ in poly]
ys = [y for poly in polys for _, y in poly]
print(f"fitted x {min(xs):.1f}..{max(xs):.1f}   y {min(ys):.1f}..{max(ys):.1f}   (box 100 x 106)")
print(f"path length {len(MARK_D)} chars")
