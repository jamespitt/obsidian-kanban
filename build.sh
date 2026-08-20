#!/bin/bash -x
npm run build
cp main.js manifest.json styles.css ../james_notes/.obsidian/plugins/obsidian-kanban
