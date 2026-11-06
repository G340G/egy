# EPISTASSI — THE LISTENING / THE THIRTEEN CUT

A first-person psychological horror investigation in a fictional stretch of the Po Valley. The central idea is a group of thirteen people who want to empty themselves so that an unheard recording can fill them. The album is never played: the game builds dread from the room, the bodies, the objects and the sounds that remain around it.

## Run locally

- macOS: double-click `start-local.command`. If it refuses to open, run `chmod +x start-local.command` once in this folder, then try again.
  For git, store the executable bit with `git update-index --chmod=+x start-local.command` before you push (uploading through the GitHub website drops it).
- Windows: double-click `start-local.bat`.
- Or run `python3 -m http.server 8765` in this folder and open `http://localhost:8765/`.

Use a current desktop browser with WebGL. Do not open `index.html` as a `file://` document. Three.js 0.160.0 is loaded from a pinned jsDelivr URL, so an Internet connection is required for the engine and for the credited archival portrait photographs. If those photographs fail, procedural 3D faces remain.

## Controls

- WASD / arrows: move (does not require pointer lock)
- Mouse: look; when pointer lock is refused, hold left mouse and drag
- E: interact, speak, examine
- F: flashlight; Shift: run; Q: hold breath
- Tab: journal; M: toggle sound
- 1 / 2 or click: dialogue choices; Esc: close dialogue

## Narrative systems

- **Thirteen cult members** live in the farmhouse. Their fates are driven by discoveries and decisions: some walk away into impossible thresholds, others collapse in front of the player and leave a stain. At the turntable, every remaining member is brought visibly into the cellar and receives a fate before the final choices unlock; no cultist is removed only by a hidden counter.
- **Il Primo**, the hidden leader, speaks from the slaughterhouse. His dialogue and Dario's earlier words leave his identity uncertain.
- **The slaughterhouse** is a new traversable location: four suspended, sculptural bovine forms, hoists, rusted rails, chains, damp brick, mould, manifestos and a threshold that returns the player to the same room from the wrong side. The imagery takes broad inspiration from Francis Bacon's distorted bodies and enclosed stage-like spaces, without recreating a specific painting.
- **The Po Valley** includes maize cultivation, winter wheat, waterlogged rice plots, canals, poplar-like trees, moving branches, wind, rain, lightning, fog and an accelerated day/night cycle.
- **Eight discoverable documents** lead to the cellar. The new ledger in the slaughterhouse is required; it lists thirteen names against the same time, 03:17.
- **Three final choices** lead to different endings: surrender your name to the empty place, open the windows and expose the carbon-monoxide explanation behind the 1977 deaths, or preserve the recording and the cult's ambiguity. Prior dialogue and the impossible passage change the wording and meaning of certain endings.
- **NPC animation** includes articulated arms and legs, slow walking, weight shifts, blinking eyelids and gaze. Faces retain the archival-photo treatment with procedural geometry underneath.
- **Sound** is entirely generated in Web Audio: wind, room tone, chain and hoist noise, hinges, drawers, clocks, machine bearings, tools, pipes, ratchets, distant knocks and a distinctive cut-air motif at each cultist's death. The forbidden record itself is never played.
- **Cinematic framing** occasionally pulls away from the player's eyes, hides the view behind foreground geometry and briefly stages the player as an observed figure.

## Publishing with GitHub Pages

1. Extract the ZIP and upload all its contents directly into the repository root (`index.html`, `style.css`, `js/`, `.github/`, launchers and scripts).
2. In Settings → Pages, choose **GitHub Actions** as the source.
3. Push to `main` or `master`, or run the workflow manually from Actions.
4. Open the Pages URL after the deployment job succeeds.

The included workflow prepares `_site/` and deploys it. The project does not require a local `node_modules` folder.

## Notes and limitations

- The photographic face fragments use external archival images credited in `ASSET_CREDITS.md`; they are not scraped indiscriminately from random personal profiles.
- Spoken lines are whispered: filtered breath and syllable-like noise, with subtitles that flicker while someone speaks. No speech synthesis is used.
- All geometric bodies, the carcass room, landscapes, plants, posters and environmental sounds are procedurally created. The bovine figures are surreal sculpture-like forms, not realistic anatomical models.
- The accelerated day/night cycle completes roughly every 4.5 minutes of active play.
- No analytics or browser fingerprint collection is included. The browser may show a generic anti-fingerprinting notice because the game uses WebGL and Canvas for ordinary 3D rendering and textures.

## Version 3.2 additions

- **Zoom and look.** Hold Z or the right mouse button to zoom. Press E on a window, a painting or the altar to look closer; the lens focuses on what you are looking at and blurs everything further away.
- **Lens.** A depth-of-field pass keeps the focus on the object in front of you. Add `?lowfx` to the URL to turn it off on slower machines.
- **Lamps and candles.** Candles flicker in the house, the church, the cellar and the abattoir. In the church, light the three candles on the altar.
- **Windows.** The house's north wall and the abattoir's east wall have openings. Through them you can see distant fires, rings of figures and a body swinging from a gallows.
- **Il Primo.** Once you have collected enough evidence, or after certain dialogue choices, a tall figure begins to walk toward you whenever you are not looking at him. The music tightens and the heartbeat quickens as he approaches. If he reaches you, the game ends.
- **Missions.** Six objectives are shown in the objective panel. They include digging the grave under the willow, which needs the shovel from the ruin and a conversation with Ottavio or Sergio.
- **Choices with consequences.** What you say to Ottavio, Ines, Dario, Anna and Sergio can open or close missions, release or summon cultists, and wake Il Primo. A fourth ending, "Leggi i nomi", appears only after you have dug up the grave.
- **Whispers.** Spoken lines are whispered instead of read aloud: filtered breath and syllable-like noise, panned left or right depending on who speaks.
- **Bacon style.** Heads and torsos are distorted, and the whole image is graded with umber shadows, a radial smear and a dark vignette that deepens with fear.

## Version 3.3 additions

- **Relics.** Nine small glowing objects are hidden across the rooms and the road. Pick them up with E. Each one is kept in the journal, and collecting all nine reveals a tenth, unnamed entry.
- **Field rituals.** Distant fires, rings of figures and bodies on posts are visible across the fields on the road.
- **Macabre details.** Skulls on fence posts, the altar and the table, jars of something pale, bone chains hanging from the beams, and crows.
- **Wording.** The 1977 newspaper clipping now reads as a report of thirteen people found dead in a country church, with the recorder still running beside them.

## Version 3.4 additions

- **The car.** Il Primo offers a ride once you have agreed to his tasks, or straight away if you ask him for somewhere quiet. The drive into the forest is dusk-dark, with the industrial glow on the horizon and the car's headlights on the trees.
- **The chase.** At the clearing he gets out and follows you. He hesitates when you watch him, lunges when you turn away, and sometimes lies about the way back. Reach the lamp at the starting point to return to the road; if he catches you, the game ends.
- **The confession.** Enter the booth in the church to hear what the priest knows about the 1977 register, including your name in it. A hand rises behind the grille, then sinks back.
- **Il Primo.** He is friendly on the surface and gives you tasks that mean something: dig the grave, light the candles. Each one leads you closer to the album and to being emptied. His dialogue changes as you progress.
- **Smoke and fire.** Ritual fires have flames and rising smoke, and each ring of figures is marked on the ground.
- **Industry.** Offices with lit windows, stacks, pipes, drill rigs and red beacons sit on the horizon. The drills make noise and the smoke rises.
- **Relics.** Each of the nine relics is modelled after what it represents: a cassette, a child's shoe, a wax-sealed envelope, a matchbox with a tooth, a Mass programme, a radio, a butcher's key, a glass eye and a wing bone.
- **Skulls removed.**

## Still to do

- Italian text remains in parts of `js/game.js` (dialogue, toasts, the cellar and abattoir scenes, the 1977 clipping) and in some of `index.html`. New and rewritten text is in English.
- The album and the voiding of the members are present but not yet reworked as the centre of the story.
- The new scenes are untested in a browser. Check the car, the chase and the confession first.

## Version 3.5 additions

- **Photographic textures.** The wood floors and panelling use a photograph of worn wooden planks, and the building walls use a photograph of flaking plaster. Both are in `assets/textures/` (Unsplash Licence; see `ASSET_CREDITS.md`). Serve the game from a web server, not as a local file, so the photos load.
- **More surfaces.** Grass covers the road and forest ground, rust covers the industrial steel, and the metal rails, car paint and industrial steel have a brushed-metal texture. These are generated in the browser.
- **Opening.** The game begins in the dark. The camera walks out of the fog behind you, and a narration whispers about why you are so easy to empty. Control returns when the walk ends.
- **Wind.** Gusts move through the sound and carry dust and leaves past the camera on the road and in the forest. The wind is almost silent indoors.

## Version 4 changes

- **Il Primo's face** is painted after Francis Bacon's *Head VI* (1949), a screaming head in a dark cage of brushed strokes. It is used for both Il Primo characters and for his hunter form.
- **The porch Il Primo** leaves after your first conversation with him. He returns as the hunter in the slaughterhouse, and in other rooms once you have completed enough missions.
- **Difficulty** rises with each completed mission. He is also faster when you are not looking at him.
- **One conversation per person.** Il Primo is the exception, because he returns with new tasks.
- **Rewards and penalties** come from the choices you make: a folded map, lower fear, a key that reveals two paintings in the house, or a closer enemy, a jump scare, or a trip. The table is `CHOICE_EFFECTS` in `js/game.js`. It is assigned from the flags in `chooseDialogue`, so check it against the dialogue text.
- **Zone soundscapes.** A chant-like choir in the church, dissonant stabs in the slaughterhouse, scraping tones in the house, and drones elsewhere.
- **Finale.** Walk toward a fire in thickening fog while the noise thins to white. The eye appears once, and the screen goes white before the ending screen.
- A few Italian lines in the code I changed are now in English.

## Not done in this version

- Downloading new textures was not possible in this environment (no internet access). Only the two photographs you supplied are used.
- Persons are not more anatomically detailed, and items are not spread out or made more realistic.
- Most of the Italian text is still in `js/game.js` and `index.html`. The lines this version touched are translated.
- The "floating signs and texts" were not identified. Point me to them and I'll remove them.
- The complex, gradual relationship with Il Primo and the claustrophobic escalation are only partly built: the enemy's return and difficulty tiers are in place, but the new story beats are not written yet.

## Version 5 changes

- **Floating sign removed.** The unsupported "MOTORE / 14-B" panel in front of the house is gone. Remaining signs are mounted on posts or boards.
- **Intro ground.** The floor now extends well beyond the zone bounds, the intro camera looks down at the ground, and the fog is thinned during the walk. The "no ground" gap should be gone.
- **Reset on loss.** Losing clears the saved evidence, and so do the retry and return buttons, so a new game starts clean.
- **Final cellar.** The record is in the far corner of the cellar, where the lamp barely reaches. Il Primo jumps to a new spot every few seconds, and he laughs each time.
- **Story and claustrophobia.** Each completed mission brings a whispered monologue from Il Primo. Fog thickens, the vignette tightens and the grain grows as the tiers rise.
- **Cinematic framing.** Letterbox bars slide in during scenes.
- **Choir.** The church chant and the ambience elsewhere are louder.
- **Hidden details.** A child's drawing, tally marks, a sack on a fence post, a hymn sheet under a pew and a bowl of water. Each has a look-closer note.

## Still to do

- The Italian text that is not part of the changed code remains in `js/game.js` and `index.html`.
- The story is still shorter than the full script. The monologues cover the psychology of Il Primo, but the relationship with him still needs more scenes.
- The "1+13 = 0" sign was not found in the code. If it is a different panel, point me to it.

