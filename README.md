<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run the app locally.

View your app in AI Studio: https://ai.studio/apps/e56850fe-b971-4cff-bf7f-ec2e6757b958

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## INFINITY Standalone

Added self-contained `standalone_index.html` and `infinity_index.html`. Core DAW operation does not require React, external modules or a localhost backend; browser capabilities are used directly for audio, storage, diagnostics and WAV rendering.
