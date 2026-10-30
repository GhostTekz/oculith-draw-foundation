// PDF.js consumes text streams with `for await`. Some WebViews provide
// ReadableStream without its optional async iterator method.
(function installStreamAsyncIterator() {
  const Stream = globalThis.ReadableStream;
  if (!Stream || typeof Symbol.asyncIterator !== 'symbol'
      || typeof Stream.prototype[Symbol.asyncIterator] === 'function') return;

  Object.defineProperty(Stream.prototype, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    value: function iterateStream() {
      const reader = this.getReader();
      let finished = false;
      async function finish(cancel, reason) {
        if (finished) return;
        finished = true;
        try { if (cancel) await reader.cancel(reason); }
        finally { reader.releaseLock(); }
      }
      return {
        async next() {
          if (finished) return { done: true, value: undefined };
          try {
            const result = await reader.read();
            if (result.done) await finish(false);
            return result;
          } catch (error) {
            await finish(false);
            throw error;
          }
        },
        async return(value) {
          await finish(true, value);
          return { done: true, value };
        },
        [Symbol.asyncIterator]() { return this; },
      };
    },
  });
})();
