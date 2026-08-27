const SKILLS_LIST_SCROLL_OFFSET_KEY = "skills-manager:skills-list-scroll-offset";

type ScrollStateStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function getScrollStateStorage(storage?: ScrollStateStorage): ScrollStateStorage | null {
  if (storage) {
    return storage;
  }

  if (typeof sessionStorage === "undefined") {
    return null;
  }

  return sessionStorage;
}

export function saveSkillsListScrollOffset(offset: number, storage?: ScrollStateStorage) {
  const targetStorage = getScrollStateStorage(storage);
  if (!targetStorage) {
    return;
  }

  targetStorage.setItem(SKILLS_LIST_SCROLL_OFFSET_KEY, String(offset));
}

export function takeSkillsListScrollOffset(storage?: ScrollStateStorage): number | null {
  const targetStorage = getScrollStateStorage(storage);
  if (!targetStorage) {
    return null;
  }

  const rawValue = targetStorage.getItem(SKILLS_LIST_SCROLL_OFFSET_KEY);
  targetStorage.removeItem(SKILLS_LIST_SCROLL_OFFSET_KEY);

  if (rawValue === null) {
    return null;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return null;
  }

  return parsedValue;
}
