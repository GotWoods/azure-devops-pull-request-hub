import { USER_SETTINGS_STORE_KEY } from "../common";

export class UserPreferences {
  public showFilterByDefault: boolean = true;
  public openPRNewWindow: boolean = true;
  public selectedProjects: string[] = [];
  public topNumberCompletedAbandoned: number = 25;
  public selectedActiveSorting: string = "desc";
  public selectedCompletedSorting: string = "asc";

  constructor(public lastVisit: Date = new Date()) {
    this.restoreToDefaults();
  }

  restoreToDefaults = (): void => {
    this.showFilterByDefault = true;
    this.openPRNewWindow = true;
    this.selectedProjects = [];
    this.topNumberCompletedAbandoned = 25;
    this.selectedActiveSorting = "desc";
    this.selectedCompletedSorting = "asc";
  };

  save = () => {
    this.lastVisit = new Date();
    localStorage.setItem(USER_SETTINGS_STORE_KEY, JSON.stringify(this));
  };

  load = () => {
    try {
      const cachedInstance = localStorage.getItem(USER_SETTINGS_STORE_KEY);

      if (!cachedInstance || cachedInstance.length === 0) {
        return;
      }

      const cachedUserSettings: UserPreferences = JSON.parse(cachedInstance);
      const savedDate = new Date(cachedUserSettings.lastVisit.toString());

      // Settings saved before the sorting preference was split per tab
      const legacySorting = (cachedUserSettings as any).selectedDefaultSorting;

      this.lastVisit = savedDate;
      this.selectedActiveSorting = cachedUserSettings.selectedActiveSorting !== undefined
        ? cachedUserSettings.selectedActiveSorting
        : legacySorting !== undefined
          ? legacySorting
          : this.selectedActiveSorting;
      this.selectedCompletedSorting = cachedUserSettings.selectedCompletedSorting !== undefined
        ? cachedUserSettings.selectedCompletedSorting
        : this.selectedCompletedSorting;
      this.openPRNewWindow = cachedUserSettings.openPRNewWindow !== undefined
        ? cachedUserSettings.openPRNewWindow
        : this.openPRNewWindow;
      this.selectedProjects = cachedUserSettings.selectedProjects !== undefined
        ? cachedUserSettings.selectedProjects
        : this.selectedProjects;
      this.showFilterByDefault = cachedUserSettings.showFilterByDefault !== undefined
        ? cachedUserSettings.showFilterByDefault
        : this.showFilterByDefault;
      this.topNumberCompletedAbandoned = cachedUserSettings.topNumberCompletedAbandoned !== undefined
        ? cachedUserSettings.topNumberCompletedAbandoned
        : this.topNumberCompletedAbandoned;
    } catch (error) {
      this.restoreToDefaults();
    }
  };
}
