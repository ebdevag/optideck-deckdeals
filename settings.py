import os
import json
import decky_plugin

class SettingsManager:
    def __init__(self, name: str, settings_directory: str):
        self.name = name
        self.settings_directory = settings_directory
        self.settings_file = os.path.join(settings_directory, f"{name}.json")
        self.settings = {}

    def read(self):
        if not os.path.exists(self.settings_directory):
            os.makedirs(self.settings_directory, exist_ok=True)

        if os.path.exists(self.settings_file):
            try:
                with open(self.settings_file, "r") as f:
                    self.settings = json.load(f)
            except Exception as e:
                decky_plugin.logger.error(f"Failed to read settings: {e}")
                self.settings = {}
        else:
            self.settings = {}

    def save(self):
        try:
            with open(self.settings_file, "w") as f:
                json.dump(self.settings, f, indent=4)
        except Exception as e:
            decky_plugin.logger.error(f"Failed to save settings: {e}")

    def getSetting(self, key: str, default):
        return self.settings.get(key, default)

    def setSetting(self, key: str, value):
        self.settings[key] = value
        self.save()
        return value
