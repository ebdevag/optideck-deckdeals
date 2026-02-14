import { ServerAPI } from "decky-frontend-lib";
import { CACHE } from "./Cache";

export enum Setting {
  FONTSIZE = "fontSize",
  PADDING_BOTTOM = "paddingBottom",
  COUNTRY = "country",
  STORES = "stores",
  ENABLED = "enabled",
  DATE_FORMAT = "dateFormat",
  SHOW_QUICK_LINKS = "showQuickLinks",
  SHOW_PREDICTIONS = "showPredictions",
  PROVIDERS = "providers",
  HISTORY_RANGE = "historyRange",
  LOCALE = "locale",
}

export let SETTINGS: Settings

export class Settings {
  private readonly serverAPI: ServerAPI;
  public defaults: Record<Setting, any> = {
    fontSize: 16,
    paddingBottom: 10,
    country: "US",
    stores: [61],
    enabled: true,
    dateFormat: "default",
    showQuickLinks: true,
    showPredictions: true,
    providers: ["itad"],
    historyRange: "1y",
    locale: "en",
  };

  constructor(serverAPI: ServerAPI) {
    this.serverAPI = serverAPI;
  }

  static init(serverAPI: ServerAPI) {
    SETTINGS = new Settings(serverAPI)
  }

  async load(key: Setting) {
    const cacheValue = await CACHE.loadValue(key)
    if (cacheValue) {
      return cacheValue
    }

    return this.serverAPI.callPluginMethod("settings_load", {
      key: key,
      defaults: this.defaults[key]

    }).then(async (response) => {
      if (response.success && response.result != undefined) {
        CACHE.setValue(key, response.result)
        return response.result;
      }
      CACHE.setValue(key, this.defaults[key])
      return this.defaults[key];
    })
  }

  async save(key: Setting, value: any) {
    CACHE.setValue(key, value)

    await this.serverAPI.callPluginMethod("settings_save", {
      key: key,
      value: value,
    });
  }
}
