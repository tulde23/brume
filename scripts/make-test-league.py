"""
A fictional 8-team league as photographed paper scoresheets, for testing InkStat end to end.

    python scripts/make-test-league.py [out_dir] [--seed N]

Writes, outside the repo by default (D:/Development/Private/inkstat-test-league):
  pages/gNN-home.jpg, pages/gNN-away.jpg   one page per team per game, like a phone photo
  truth/gNN-home.json, truth/gNN-away.json answers in the test bench's BenchTruth shape
  bench/gNN-home/{page.jpg,truth.json}      the same pages in the test bench's sample layout
  league.json                               teams, rosters, every game's box score, standings

To run them on the bench:
  scripts/push-bench.sh "D:/Development/Private/brume-bench-samples,D:/Development/Private/inkstat-test-league/bench"
then make a template on one page and run inkstat://bench?run=template&only=g0*  (or all of them).

Every name is invented. The numbers are consistent the way a real book is: player points
come from 2s, 3s and free throws, quarters add up to the final, fouls stay at 5 or under,
team fouls per half match the players' fouls.
"""
import json
import math
import os
import random
import sys
from datetime import date, timedelta

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else 'D:/Development/Private/inkstat-test-league'
SEED = int(sys.argv[sys.argv.index('--seed') + 1]) if '--seed' in sys.argv else 2026
rng = random.Random(SEED)

FONT_DIR = 'C:/Windows/Fonts/'
PRINT = FONT_DIR + 'arial.ttf'
PRINT_BOLD = FONT_DIR + 'arialbd.ttf'
HANDS = [FONT_DIR + 'Inkfree.ttf', FONT_DIR + 'segoepr.ttf']

TEAMS = [
    ('Cedar Ridge', 'Hawks'), ('Millbrook', 'Comets'), ('North Fork', 'Rams'), ('Pine Hollow', 'Owls'),
    ('Riverside', 'Stars'), ('Stone Creek', 'Bears'), ('Westfield', 'Falcons'), ('Oak Valley', 'Knights'),
]
FIRST = ['Aiden', 'Ben', 'Caleb', 'Dante', 'Eli', 'Finn', 'Gabe', 'Hayes', 'Isaac', 'Jalen', 'Kai', 'Liam', 'Mason',
         'Nico', 'Owen', 'Parker', 'Quinn', 'Reid', 'Sam', 'Tate', 'Uriah', 'Vince', 'Wes', 'Xavier', 'Yusuf', 'Zane',
         'Marcus', 'Jonah', 'Troy', 'Cole', 'Drew', 'Evan', 'Grant', 'Isaiah', 'Jace', 'Kobe', 'Luca', 'Miles']
LAST = ['Abbott', 'Barrow', 'Calder', 'Dunmore', 'Ellison', 'Fairley', 'Garrick', 'Holloway', 'Ingram', 'Jessup',
        'Kessler', 'Lindqvist', 'Marlow', 'Nyland', 'Okafor', 'Pruitt', 'Quarles', 'Rourke', 'Saldana', 'Thorne',
        'Upshaw', 'Vance', 'Whitlock', 'Yardley', 'Zeller', 'Brandt', 'Castile', 'Delacroix', 'Everly', 'Fenwick',
        'Galloway', 'Hartigan', 'Iverson', 'Juarez', 'Kimura', 'Lockhart', 'Mendez', 'Navarro', 'Osei', 'Pacheco',
        'Redfern', 'Sorensen', 'Tolliver', 'Varga', 'Winslow', 'Yeager', 'Ashby', 'Bramlett', 'Corwin', 'Dorsey']
COACH = ['Hale', 'Merritt', 'Coyle', 'Brennan', 'Sutter', 'Ames', 'Dobbs', 'Kerr', 'Lyle', 'Pratt']


def make_team(i, town, mascot):
    used = set()
    players = []
    numbers = rng.sample([str(n) for n in [0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15, 20, 21, 22, 23, 24, 25, 30, 31, 32, 33, 34, 35, 40, 41, 42, 44, 50, 52]], 12)
    for n in sorted(numbers, key=int):
        while True:
            last = rng.choice(LAST)
            if last not in used:
                used.add(last)
                break
        # How much of the scoring this player tends to take.
        players.append({'no': n, 'first': rng.choice(FIRST), 'last': last, 'weight': rng.choice([0.4, 0.7, 1, 1, 1.5, 2, 3])})
    return {
        'id': f't{i + 1}',
        'name': mascot,
        'school': f'{town} High School',
        'town': town,
        'coach': COACH[i] if i < len(COACH) else rng.choice(COACH),
        'strength': rng.uniform(-8, 8),
        'players': players,
    }


teams = [make_team(i, t, m) for i, (t, m) in enumerate(TEAMS)]


def schedule():
    """Single round robin (7 rounds), then 3 more rounds of fresh pairings: 10 games each."""
    ids = list(range(8))
    rounds = []
    for r in range(7):
        pairs = []
        for k in range(4):
            a, b = ids[k], ids[7 - k]
            pairs.append((a, b) if (r + k) % 2 == 0 else (b, a))
        rounds.append(pairs)
        ids = [ids[0]] + [ids[-1]] + ids[1:-1]
    for _ in range(3):
        order = list(range(8))
        rng.shuffle(order)
        rounds.append([(order[k], order[k + 1]) for k in range(0, 8, 2)])
    return rounds


def split(total, parts, weights):
    """total -> `parts` non-negative ints, roughly by weights."""
    raw = [w * rng.uniform(0.7, 1.3) for w in weights]
    s = sum(raw)
    out = [int(total * r / s) for r in raw]
    while sum(out) < total:
        out[rng.randrange(parts)] += 1
    return out


def box_score(team, points):
    """Player lines that add up to `points`: 2s, 3s, free throws; fouls up to 5."""
    dressed = rng.sample(team['players'], rng.randint(9, 12))
    dressed.sort(key=lambda p: int(p['no']))
    lines = {p['no']: {'fg2': 0, 'fg3': 0, 'ftm': 0, 'fta': 0} for p in dressed}
    weights = [p['weight'] for p in dressed]
    left = points
    while left > 0:
        p = rng.choices(dressed, weights)[0]
        line = lines[p['no']]
        kind = rng.choices(['2', '3', 'ft'], [0.58, 0.2, 0.22])[0]
        if kind == '3' and left >= 3:
            line['fg3'] += 1
            left -= 3
        elif kind == '2' and left >= 2:
            line['fg2'] += 1
            left -= 2
        else:
            line['ftm'] += 1
            line['fta'] += 1
            left -= 1
    out = []
    for p in dressed:
        l = lines[p['no']]
        l['fta'] += rng.choice([0, 0, 0, 1, 1, 2])
        pts = 2 * l['fg2'] + 3 * l['fg3'] + l['ftm']
        fouls = min(5, max(0, round(rng.gauss(1.4, 1.1) * p['weight'] ** 0.3)))
        out.append({'no': p['no'], 'name': f"{p['first'][0]}. {p['last']}", 'last': p['last'], **l, 'points': pts, 'fouls': fouls})
    return out


def play(home, away, when, number):
    while True:
        h = max(28, round(rng.gauss(52 + home['strength'] + 2.5, 8)))
        a = max(28, round(rng.gauss(52 + away['strength'], 8)))
        if h != a:
            break
    sides = {}
    for side, team, pts in (('home', home, h), ('away', away, a)):
        players = box_score(team, pts)
        # The sheet has 10 team-foul boxes per half; real teams rarely pass ~20 anyway.
        while sum(p['fouls'] for p in players) > 19:
            rng.choice([p for p in players if p['fouls'] > 0])['fouls'] -= 1
        fouls = sum(p['fouls'] for p in players)
        first_half = min(10, fouls, max(fouls - 10, round(fouls * rng.uniform(0.35, 0.6))))
        sides[side] = {
            'team': team['id'],
            'name': team['name'],
            'coach': team['coach'],
            'periods': split(pts, 4, [1, 1, 1, 1.1]),
            'final': pts,
            'timeouts': rng.randint(1, 4),
            'teamFouls': [first_half, fouls - first_half],
            'players': players,
        }
    return {
        'id': f'g{number:02d}',
        'date': when.isoformat(),
        'location': f"{home['town']} High School",
        'home': sides['home'],
        'away': sides['away'],
    }


# ------------------------------------------------------------------ drawing

W, H = 1700, 2200
LEFT, RIGHT = 80, 1620
ROW_H, ROWS = 80, 12
T_TOP = 470
COLS = [('NO.', 80, 190), ('PLAYER', 190, 640), ('P1', 640, 712), ('P2', 712, 784), ('P3', 784, 856), ('P4', 856, 928),
        ('P5', 928, 1000), ('2PT', 1000, 1130), ('3PT', 1130, 1260), ('FTM', 1260, 1370), ('FTA', 1370, 1480), ('TP', 1480, 1620)]


def font(path, size):
    return ImageFont.truetype(path, size)


def form(d):
    """The printed scoresheet, the same on every page."""
    ink = (30, 30, 34)
    d.text((W / 2, 70), 'VARSITY BASKETBALL  OFFICIAL SCORESHEET', font=font(PRINT_BOLD, 44), fill=ink, anchor='mm')
    d.text((W / 2, 118), 'TRI-COUNTY CONFERENCE', font=font(PRINT, 24), fill=ink, anchor='mm')
    label = font(PRINT_BOLD, 20)

    def field(x0, y0, x1, y1, name):
        d.rectangle([x0, y0, x1, y1], outline=ink, width=3)
        d.text((x0 + 10, y0 + 8), name, font=label, fill=ink)

    field(80, 160, 940, 250, 'TEAM')
    field(960, 160, 1620, 250, '')
    for k, (txt, x) in enumerate((('HOME', 990), ('VISITOR', 1270))):
        d.rectangle([x, 188, x + 34, 222], outline=ink, width=3)
        d.text((x + 50, 205), txt, font=font(PRINT_BOLD, 26), fill=ink, anchor='lm')
    field(80, 260, 940, 350, 'OPPONENT')
    field(960, 260, 1300, 350, 'DATE')
    field(1320, 260, 1620, 350, 'GAME NO.')
    field(80, 360, 940, 450, 'COACH')
    field(960, 360, 1620, 450, 'PLAYED AT')

    # Player table
    head = T_TOP
    d.rectangle([LEFT, head, RIGHT, head + 50 + ROW_H * ROWS + ROW_H], outline=ink, width=4)
    d.text(((640 + 1000) / 2, head - 2), 'PERSONAL FOULS', font=font(PRINT_BOLD, 18), fill=ink, anchor='md')
    d.text(((1260 + 1480) / 2, head - 2), 'FREE THROWS', font=font(PRINT_BOLD, 18), fill=ink, anchor='md')
    for name, x0, x1 in COLS:
        d.text(((x0 + x1) / 2, head + 25), name, font=font(PRINT_BOLD, 22), fill=ink, anchor='mm')
        d.line([x0, head, x0, head + 50 + ROW_H * (ROWS + 1)], fill=ink, width=2)
    d.line([LEFT, head + 50, RIGHT, head + 50], fill=ink, width=3)
    for r in range(1, ROWS + 1):
        y = head + 50 + r * ROW_H
        d.line([LEFT, y, RIGHT, y], fill=ink, width=3 if r == ROWS else 1)
    d.text((200, head + 50 + ROWS * ROW_H + ROW_H / 2), 'TEAM TOTALS', font=font(PRINT_BOLD, 24), fill=ink, anchor='lm')

    # Score by quarter
    top = 1660
    d.text((LEFT, top - 10), 'SCORE BY QUARTER', font=font(PRINT_BOLD, 22), fill=ink, anchor='ld')
    for k, q in enumerate(['1ST', '2ND', '3RD', '4TH', 'OT', 'FINAL']):
        x0 = LEFT + k * 150
        d.rectangle([x0, top, x0 + 150, top + 120], outline=ink, width=3)
        d.text((x0 + 75, top + 22), q, font=font(PRINT_BOLD, 22), fill=ink, anchor='mm')
    # Timeouts
    d.text((1060, top - 10), 'TIMEOUTS', font=font(PRINT_BOLD, 22), fill=ink, anchor='ld')
    for k in range(5):
        x0 = 1060 + k * 112
        d.rectangle([x0, top, x0 + 100, top + 90], outline=ink, width=3)
    # Team fouls
    tf = 1880
    d.text((LEFT, tf - 10), 'TEAM FOULS', font=font(PRINT_BOLD, 22), fill=ink, anchor='ld')
    for h, half in enumerate(['1ST HALF', '2ND HALF']):
        y0 = tf + h * 90
        d.text((LEFT + 10, y0 + 38), half, font=font(PRINT_BOLD, 22), fill=ink, anchor='lm')
        for k in range(10):
            x0 = 260 + k * 76
            d.rectangle([x0, y0, x0 + 66, y0 + 70], outline=ink, width=2)
    d.line([1060, 2110, 1620, 2110], fill=ink, width=2)
    d.text((1060, 2120), 'SCORER', font=font(PRINT_BOLD, 18), fill=ink)
    d.line([LEFT, 2110, 700, 2110], fill=ink, width=2)
    d.text((LEFT, 2120), 'REFEREE', font=font(PRINT_BOLD, 18), fill=ink)


class Hand:
    """One scorer's handwriting: a font, a pen colour, a size, a little wobble."""

    def __init__(self):
        self.path = rng.choice(HANDS)
        self.colour = rng.choice([(28, 40, 110), (35, 35, 40), (60, 60, 70)])
        self.size = rng.randint(44, 52)

    def write(self, page, x, y, text, size=None, anchor='lm'):
        f = font(self.path, size or self.size)
        box = f.getbbox(text)
        w, h = box[2] - box[0] + 20, box[3] - box[1] + 30
        tile = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(tile).text((10 - box[0], 15 - box[1]), text, font=f, fill=self.colour + (235,))
        tile = tile.rotate(rng.uniform(-2.5, 2.5), resample=Image.BICUBIC, expand=True)
        dx, dy = rng.uniform(-5, 5), rng.uniform(-4, 4)
        if anchor == 'mm':
            px, py = x - tile.width / 2, y - tile.height / 2
        else:
            px, py = x, y - tile.height / 2
        page.alpha_composite(tile, (int(px + dx), int(py + dy)))

    def mark(self, d, x0, y0, x1, y1, kind='x'):
        c = self.colour + (235,)
        j = lambda v: v + rng.uniform(-4, 4)
        pad = 14
        if kind == 'x':
            d.line([j(x0 + pad), j(y0 + pad), j(x1 - pad), j(y1 - pad)], fill=c, width=5)
            d.line([j(x1 - pad), j(y0 + pad), j(x0 + pad), j(y1 - pad)], fill=c, width=5)
        else:
            d.line([j(x0 + pad), j(y1 - pad), j(x1 - pad), j(y0 + pad)], fill=c, width=5)


def short_date(iso):
    y, m, dd = iso.split('-')
    return f'{int(m)}/{int(dd)}/{y[2:]}'


def draw_page(game, side):
    me = game[side]
    them = game['away' if side == 'home' else 'home']
    page = Image.new('RGBA', (W, H), (250, 248, 241, 255))
    d = ImageDraw.Draw(page)
    form(d)
    hand = Hand()
    hand.write(page, 210, 214, me['name'].upper() if rng.random() < 0.5 else me['name'])
    hand.mark(d, 990 if side == 'home' else 1270, 188, 1024 if side == 'home' else 1304, 222)
    hand.write(page, 260, 314, them['name'])
    hand.write(page, 1040, 314, short_date(game['date']), size=hand.size - 6)
    hand.write(page, 1470, 314, str(int(game['id'][1:])), anchor='mm')
    hand.write(page, 210, 414, me['coach'])
    hand.write(page, 1130, 414, game['location'].replace(' High School', ' HS'), size=hand.size - 6)

    for r, p in enumerate(me['players']):
        cy = T_TOP + 50 + r * ROW_H + ROW_H / 2
        hand.write(page, 135, cy, p['no'], anchor='mm')
        hand.write(page, 205, cy, p['name'], size=hand.size - 4)
        for f in range(p['fouls']):
            x0 = 640 + f * 72
            hand.mark(d, x0, cy - ROW_H / 2, x0 + 72, cy + ROW_H / 2)
        for key, (x0, x1) in (('fg2', (1000, 1130)), ('fg3', (1130, 1260)), ('ftm', (1260, 1370)), ('fta', (1370, 1480)), ('points', (1480, 1620))):
            v = p[key]
            if key != 'points' and v == 0 and rng.random() < 0.5:
                continue  # scorers often leave zeros blank
            hand.write(page, (x0 + x1) / 2, cy, str(v), anchor='mm')
    ty = T_TOP + 50 + ROWS * ROW_H + ROW_H / 2
    hand.write(page, 1550, ty, str(me['final']), anchor='mm')
    hand.write(page, 1065, ty, str(sum(p['fg2'] for p in me['players'])), anchor='mm', size=hand.size - 6)
    hand.write(page, 1195, ty, str(sum(p['fg3'] for p in me['players'])), anchor='mm', size=hand.size - 6)

    for k, v in enumerate(me['periods']):
        hand.write(page, LEFT + k * 150 + 75, 1660 + 80, str(v), anchor='mm')
    hand.write(page, LEFT + 5 * 150 + 75, 1660 + 80, str(me['final']), anchor='mm')
    for k in range(me['timeouts']):
        x0 = 1060 + k * 112
        hand.mark(d, x0, 1660, x0 + 100, 1660 + 90, kind='slash')
    for h, n in enumerate(me['teamFouls']):
        for k in range(min(n, 10)):
            x0 = 260 + k * 76
            hand.mark(d, x0, 1880 + h * 90, x0 + 66, 1880 + h * 90 + 70)
    hand.write(page, 1100, 2080, rng.choice(['J. Ortiz', 'K. Lam', 'R. Banks', 'T. Moss']), size=hand.size - 10)
    return page


def photograph(page):
    """Like a phone photo of the sheet on a table: a little turned, shadowed, softened."""
    page = page.convert('RGB')
    noise = Image.effect_noise((W, H), 9).convert('L')
    page = Image.composite(page, Image.new('RGB', (W, H), (236, 233, 224)), noise.point(lambda v: 255 if v > 118 else 225))
    page = page.filter(ImageFilter.GaussianBlur(0.6))
    angle = rng.uniform(-1.6, 1.6)
    bg = Image.new('RGB', (W + 220, H + 260), rng.choice([(84, 78, 72), (110, 104, 96), (60, 64, 70)]))
    shadow = Image.new('L', bg.size, 0)
    ImageDraw.Draw(shadow).rectangle([118, 140, 118 + W, 140 + H], fill=110)
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    bg.paste((20, 20, 20), mask=shadow)
    rotated = page.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=(0, 0, 0))
    mask = Image.new('L', page.size, 255).rotate(angle, expand=True)
    ox = (bg.width - rotated.width) // 2 + rng.randint(-20, 20)
    oy = (bg.height - rotated.height) // 2 + rng.randint(-20, 20)
    bg.paste(rotated, (ox, oy), mask)
    # Uneven light, brighter at one corner.
    light = Image.radial_gradient('L').resize(bg.size).point(lambda v: 255 - v // 6)
    return Image.composite(bg, Image.new('RGB', bg.size, (0, 0, 0)), light)


def truth(game, side):
    me = game[side]
    them = game['away' if side == 'home' else 'home']
    return {
        'id': f"{game['id']}-{side}",
        'layout': 'InkStat test league sheet (P1-P5 foul boxes, 2PT/3PT/FTM/FTA, TP column)',
        'teamName': me['name'],
        'coach': me['coach'],
        'date': short_date(game['date']),
        'location': game['location'].replace(' High School', ' HS'),
        'periods': me['periods'],
        'final': me['final'],
        'players': [{'no': p['no'], 'name': p['name'], 'points': p['points'], 'fouls': p['fouls'],
                     'fg2': p['fg2'], 'fg3': p['fg3'], 'ftm': p['ftm'], 'fta': p['fta']} for p in me['players']],
        # Which game and which side: the bench pairs a game's two pages and saves it.
        'game': game['id'],
        'side': side,
        'opponent': them['name'],
        'timeouts': me['timeouts'],
        'teamFouls': me['teamFouls'],
    }


def main():
    os.makedirs(f'{OUT}/pages', exist_ok=True)
    os.makedirs(f'{OUT}/truth', exist_ok=True)
    games = []
    day = date(2026, 12, 1)  # a Tuesday
    for r, pairs in enumerate(schedule()):
        for home, away in pairs:
            games.append(play(teams[home], teams[away], day, len(games) + 1))
        day += timedelta(days=3 if day.weekday() == 1 else 4)  # Tuesdays and Fridays
    record = {t['id']: {'team': t['name'], 'w': 0, 'l': 0, 'pf': 0, 'pa': 0} for t in teams}
    for g in games:
        h, a = g['home'], g['away']
        record[h['team']]['pf'] += h['final']
        record[h['team']]['pa'] += a['final']
        record[a['team']]['pf'] += a['final']
        record[a['team']]['pa'] += h['final']
        win, lose = (h, a) if h['final'] > a['final'] else (a, h)
        record[win['team']]['w'] += 1
        record[lose['team']]['l'] += 1
        for side in ('home', 'away'):
            sid = f"{g['id']}-{side}"
            photograph(draw_page(g, side)).save(f"{OUT}/pages/{sid}.jpg", quality=86)
            with open(f"{OUT}/truth/{sid}.json", 'w') as f:
                json.dump(truth(g, side), f, indent=1)
            # The bench's layout: one folder per sample. A hard link, so no second copy on disk.
            os.makedirs(f'{OUT}/bench/{sid}', exist_ok=True)
            for src, dst in ((f'{OUT}/pages/{sid}.jpg', 'page.jpg'), (f'{OUT}/truth/{sid}.json', 'truth.json')):
                target = f'{OUT}/bench/{sid}/{dst}'
                if os.path.exists(target):
                    os.remove(target)
                try:
                    os.link(src, target)
                except OSError:
                    import shutil
                    shutil.copyfile(src, target)
        print(g['id'], g['date'], f"{h['name']} {h['final']} - {a['final']} {a['name']}")
    standings = sorted(record.values(), key=lambda r: (-r['w'], r['l'], -(r['pf'] - r['pa'])))
    league = {
        'league': 'Tri-County Conference (fictional test data)',
        'season': '2026-27',
        'seed': SEED,
        'teams': [{k: v for k, v in t.items() if k != 'strength'} for t in teams],
        'games': games,
        'standings': standings,
    }
    with open(f'{OUT}/league.json', 'w') as f:
        json.dump(league, f, indent=1)
    print('\nStandings')
    for s in standings:
        print(f"  {s['team']:<10} {s['w']}-{s['l']}  {s['pf']}-{s['pa']}")


if __name__ == '__main__':
    main()
