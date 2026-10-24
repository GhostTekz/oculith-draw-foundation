export function createInflightKeyGate() {
  let generation = 0;
  let current = null;

  return {
    begin(key) {
      if (current?.key === key) return null;
      current = { key, generation: ++generation };
      return current;
    },

    cancel() {
      generation++;
      current = null;
    },

    isCurrent(token) {
      return current === token && token.generation === generation;
    },

    // Een bewegende weergave mag begin() niet opnieuw aanroepen: een nieuwe
    // key vervangt het lopende verzoek en de render komt nooit af.
    busy() {
      return current !== null;
    },

    finish(token) {
      if (!this.isCurrent(token)) return false;
      current = null;
      return true;
    },
  };
}
