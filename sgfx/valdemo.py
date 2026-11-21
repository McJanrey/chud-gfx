"""A made-up VALORANT match for trying the HUD and the graphics without a game: buy phases, fights, players dying,
the spike, round wins, credits and ultimates, played out fast (a round in about 30 s). Not a model of the game,
just believable numbers that move. Feeds the VALORANT module (engine.val) the same way a reader does.
"""
import random
import threading
import time

AGENTS = ("Jett", "Sova", "Omen", "Killjoy", "Skye", "Raze", "Fade", "Viper", "Cypher", "Breach")
NAMES = (("Kai", "Rook", "Vesper", "Lumen", "Brick"), ("Ember", "Sable", "Tidal", "Quill", "Onyx"))
TEAMS = ("Saints", "Lancers")


class Demo:
    def __init__(self, engine):
        self.engine, self.on, self._stop = engine, False, threading.Event()

    def start(self):
        if self.on:
            return
        self.on = True
        self._stop.clear()
        threading.Thread(target=self.run, daemon=True, name="val-demo").start()

    def stop(self):
        self.on = False
        self._stop.set()

    def send(self, body):
        try:
            self.engine.val.ingest(body)
        except ValueError:
            self.stop()   # (VALORANT switched off on the Outputs page)

    def wait(self, s):
        return self._stop.wait(s)

    def run(self):
        rnd = random.Random()
        score, credits, ult = [0, 0], [[800] * 5, [800] * 5], [[0] * 5, [0] * 5]
        kda = [[[0, 0, 0] for _ in range(5)] for _ in range(2)]
        maxult = [[7, 8, 7, 8, 6], [8, 7, 9, 7, 8]]
        players = lambda alive, hp: [{"team": t, "slot": s + 1, "name": NAMES[t][s], "agent": AGENTS[t * 5 + s], "alive": alive[t][s],
                                      "health": hp[t][s], "credits": credits[t][s], "ult": ult[t][s], "ult_max": maxult[t][s],
                                      "kills": kda[t][s][0], "deaths": kda[t][s][1], "assists": kda[t][s][2], "weapon": "Vandal" if credits[t][s] > 2900 else "Classic"}
                                     for t in range(2) for s in range(5)]
        self.send({"teams": [{"name": TEAMS[0], "score": 0}, {"name": TEAMS[1], "score": 0}], "map": "Ascent", "first_attack": 1, "round": 1})
        r = 1
        while self.on and max(score) < 13 or (self.on and abs(score[0] - score[1]) < 2):
            alive = [[True] * 5, [True] * 5]
            hp = [[100] * 5, [100] * 5]
            for secs in range(30, -1, -6):   # buy phase
                self.send({"round": r, "phase": "buy", "timer": f"0:{secs:02d}", "spike": "", "players": players(alive, hp)})
                if self.wait(1):
                    return
            planted = False
            for secs in range(100, -1, -5):   # the fight
                if self.wait(0.7):
                    return
                t = rnd.randrange(2)
                live = [s for s in range(5) if alive[t][s]]
                other = [s for s in range(5) if alive[1 - t][s]]
                if live and other and rnd.random() < 0.45:
                    k, v = rnd.choice(live), rnd.choice(other)
                    hp[1 - t][v] -= rnd.choice((30, 60, 100, 100))
                    if hp[1 - t][v] <= 0:
                        hp[1 - t][v], alive[1 - t][v] = 0, False
                        kda[t][k][0] += 1
                        kda[1 - t][v][1] += 1
                        ult[t][k] = min(maxult[t][k], ult[t][k] + 1)
                if not planted and secs < 60 and rnd.random() < 0.2:
                    planted = True
                self.send({"phase": "combat", "timer": "" if planted else f"{secs // 60}:{secs % 60:02d}", "spike": "planted" if planted else "",
                           "players": players(alive, hp)})
                if not any(alive[0]) or not any(alive[1]):
                    break
            won = 0 if sum(alive[0]) > sum(alive[1]) else 1 if sum(alive[1]) > sum(alive[0]) else rnd.randrange(2)
            score[won] += 1
            for t in range(2):
                for s in range(5):
                    credits[t][s] = min(9000, credits[t][s] + (3000 if t == won else 1900) - (2900 if credits[t][s] > 3900 else 0))
            self.send({"teams": [{"score": score[0]}, {"score": score[1]}], "event": "round_end", "winner": won,
                       "how": "spike" if planted and rnd.random() < 0.5 else "elimination", "phase": "end", "spike": ""})
            if self.wait(3):
                return
            r += 1
        if self.on:
            self.send({"event": "map_end", "winner": 0 if score[0] > score[1] else 1})
        self.on = False


def start(engine):
    engine.valdemo = Demo(engine)
