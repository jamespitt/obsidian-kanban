#!/bin/bash -x
npm run build
cp main.js manifest.json styles.css ../james_notes/.obsidian/plugins/obsidian-kanban
cp main.js manifest.json styles.css ../tm_notes/.obsidian/plugins/obsidian-kanban
