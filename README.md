# Derbyboard

## Record your roller derby tactics from your browser

Derbyboard is an interactive web application that enables recording of roller derby strategies through your browser, with optional audio capture.

The main goal is to make it as easy as possible sharing roller derby tactics and game situations, making it an effective tool for coaches, players, officials and teams to talk about the game.

## Core features

✨ Track Visualization & interractions

- Regulation-size roller derby track
- Dynamic pack and engagement zone indicators
- Status-based player coloring system
- Multitouch support (select multiple players)

🎮 Board state

- Save and load board state
- Reset board state
- Save & reload animation sequences

🎥 Recording Capabilities

- High-quality video capture
- Optional audio commentary
- Direct browser recording
- Download in .mp4 format
- Capture the board as an image
- Preview before download

### Potential ideas

🚀 Strategic features

- Pre-configured set plays (starts, power jams, etc.)
- Keyboard shortcuts for player control


🎮 Interactive Elements

- Custom shape drawing tools (arrows, circles)
- Embedded video titles
- Webcam overlay integration

🎨 Branding

- Custom logo customization
- Custom video title

I will implement new features based on your feedback and usecases, please open an issue (or send an email to ruihildt@protonmail.com ) if you have any.

## Prior art & inspiration

### New Ultimate Roller Derby Simulator

NURDS is great and I initially tried to record the track with it, but it turns out SVG animation doesn't work well for that usecase.

I have been tempted to call this project YARDS (Yet Another Roller Derby Simulator) in homage to NURDS.

[Source code](https://github.com/fa-bien/nurds) | [Demo](https://nurds.space/)

### Roller Derby Track Visualization

Innovative 3D approach to track visualization.

[Source code](https://github.com/webdingens/track-viz) | [Demo](https://trackviz.netlify.app/)

## Technical details

### Technical stack

- HTML Canvas
- MediaRecorder API for audio capture
- Svelte + Flowbite for the UI

### About the LLM usage

I have written very few lines of code in this project, on purpose. It is a trial to see how far I can come by prompt engineering with LLMs.

While I'm an ok frontend developer, without LLM help, I would have probably never been able to get this far. I suck at geometry and had no previous experience in HTML canvas, animating game state or browser recording. I can't even double check if everything is correct `¯\_(ツ)\_/¯`.

If you have any suggestions on how to improve the code, I would love to hear them.

### Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```bash
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

### Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run preview`.

## License

The license of this project is debatable, since what the license of content produced by LLM is still unclear, as there are multiple ongoing lawsuits.

Assuming that the code here is mine, I hereby license it under the [AGPL license](https://www.gnu.org/licenses/agpl-3.0.en.html).
