export interface Store {
    id: number;
    title: string;
}

export const STORES: Store[] = [
    { id: 19, title: "2game" },
    { id: 2, title: "AllYouPlay" },
    { id: 4, title: "Blizzard" },
    { id: 13, title: "DLGamer" },
    { id: 15, title: "Dreamgame" },
    { id: 52, title: "EA Store" },
    { id: 16, title: "Epic Game Store" },
    { id: 6, title: "Fanatical" },
    { id: 20, title: "GameBillet" },
    { id: 24, title: "GamersGate" },
    { id: 25, title: "Gamesload" },
    { id: 27, title: "GamesPlanet DE" },
    { id: 28, title: "GamesPlanet FR" },
    { id: 26, title: "GamesPlanet UK" },
    { id: 29, title: "GamesPlanet US" },
    { id: 35, title: "GOG" },
    { id: 36, title: "GreenManGaming" },
    { id: 37, title: "Humble Store" },
    { id: 42, title: "IndieGala Store" },
    { id: 65, title: "JoyBuggy" },
    { id: 47, title: "MacGameStore" },
    { id: 48, title: "Microsoft Store" },
    { id: 49, title: "Newegg" },
    { id: 50, title: "Nuuvem" },
    { id: 73, title: "PlanetPlay" },
    { id: 74, title: "PlayerLand" },
    { id: 70, title: "Playsum" },
    { id: 61, title: "Steam" },
    { id: 62, title: "Ubisoft Store" },
    { id: 64, title: "WinGameStore" }
].sort((a, b) => a.title.localeCompare(b.title));
