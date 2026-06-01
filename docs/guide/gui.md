# Desktop GUI

The RDSS Folder Mapper desktop application is designed for researchers who want a simple, point-and-click way to mount their network research storage folders on their computer.

## Main window

![RDSS Folder Mapper main window](/screenshots/gui-main.png)

The main window has three sections:

| Section | Description |
|---------|-------------|
| **Status bar** | Shows the current state (Ready, Mapping, Error). |
| **Map Research Folders** | Fetches your approved project list and creates folder shortcuts on your Desktop. |
| **Remove Mappings** | Removes all previously created folder shortcuts. |

At the bottom, the **Activity log** toggle reveals a detailed log of every action the tool performs. This is useful for troubleshooting.

## Mapping your folders

1. Click **Map Research Folders**.
2. A progress bar appears, showing each folder as it is mapped.
3. When complete, the bar turns green and the status changes to **Folders mapped**.

Mapped folders appear in `~/Desktop/RDSS Folders` (or your configured base directory) and can be browsed like any regular folder.

![Progress during mapping](/screenshots/gui-progress.png)

## Settings

Click the **⚙** (gear) icon in the top-right corner to open the Settings panel.

![Settings panel](/screenshots/gui-settings.png)

| Setting | Description | Default |
|---------|-------------|---------|
| **Mappings folder** | Where folder shortcuts are created on your computer. | `~/Desktop/RDSS Folders` |
| **Remote storage path** | The network path to your institution's research storage. | Provided by your IT department |
| **DMP service URL** | The URL of the Data Management Plan service that provides your project list. | Provided by your institution |
| **Debug logging** | Enables verbose output in the Activity log. | Off |

Click **Save settings** to persist your changes. Settings are stored locally and remembered between sessions.

## Troubleshooting

- **"Error — see activity log"**: Expand the Activity log to see what went wrong. Common causes are network connectivity issues or an expired authentication session.
- **Folders not appearing**: Ensure the base directory exists. If you changed it in Settings, create the folder manually first.
- **macOS security warning on first launch**: Right-click the app and choose **Open**, then confirm.
