import { useRef, useState, useEffect, useCallback, forwardRef } from "react";

interface CustomCaretInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "style"> {
  style?: React.CSSProperties;
}

export const CustomCaretInput = forwardRef<HTMLInputElement, CustomCaretInputProps>(
  function CustomCaretInput(
    {
      style,
      value,
      onChange,
      onFocus,
      onBlur,
      onCompositionStart,
      onCompositionEnd,
      onScroll,
      className,
      ...props
    },
    forwardedRef,
  ) {
    const localRef = useRef<HTMLInputElement | null>(null);
    const [caret, setCaret] = useState({
      left: 0,
      top: 0,
      height: 0,
      width: 2,
      visible: false,
    });
    const [isComposing, setIsComposing] = useState(false);

    const setRef = useCallback(
      (node: HTMLInputElement | null) => {
        localRef.current = node;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          forwardedRef.current = node;
        }
      },
      [forwardedRef],
    );

    const updateCaret = useCallback(() => {
      const input = localRef.current;
      if (!input) return;

      const isFocused = document.activeElement === input;
      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? 0;
      const hasSelection = start !== end;

      if (!isFocused || hasSelection || isComposing) {
        setCaret((prev) => ({ ...prev, visible: false }));
        return;
      }

      const computed = getComputedStyle(input);
      const paddingLeft = parseFloat(computed.paddingLeft) || 0;
      const paddingTop = parseFloat(computed.paddingTop) || 0;
      const fontSize = parseFloat(computed.fontSize) || 14;
      const fontFamily = computed.fontFamily;
      const fontWeight = computed.fontWeight;
      const rawLineHeight = computed.lineHeight;
      const lineHeight =
        rawLineHeight === "normal"
          ? fontSize * 1.4
          : parseFloat(rawLineHeight) || fontSize * 1.4;

      const text = String(value ?? "").slice(0, start);
      const width = measureText(text, `${fontWeight} ${fontSize}px ${fontFamily}`);

      const caretWidth = Math.max(2, Math.round(fontSize / 6));
      const caretHeight = fontSize * 1.25;
      const top = paddingTop + (lineHeight - caretHeight) / 2;
      const left = paddingLeft + width - input.scrollLeft;

      setCaret({
        left,
        top,
        height: caretHeight,
        width: caretWidth,
        visible: true,
      });
    }, [value, isComposing]);

    useEffect(() => {
      const handleSelectionChange = () => {
        if (document.activeElement === localRef.current) {
          updateCaret();
        }
      };
      document.addEventListener("selectionchange", handleSelectionChange);
      return () => document.removeEventListener("selectionchange", handleSelectionChange);
    }, [updateCaret]);

    useEffect(() => {
      updateCaret();
    }, [value, updateCaret]);

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      updateCaret();
      onFocus?.(e);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      setCaret((prev) => ({ ...prev, visible: false }));
      onBlur?.(e);
    };

    const handleCompositionStartEvent = (e: React.CompositionEvent<HTMLInputElement>) => {
      setIsComposing(true);
      setCaret((prev) => ({ ...prev, visible: false }));
      onCompositionStart?.(e);
    };

    const handleCompositionEndEvent = (e: React.CompositionEvent<HTMLInputElement>) => {
      setIsComposing(false);
      onCompositionEnd?.(e);
      requestAnimationFrame(updateCaret);
    };

    const handleScrollEvent = (e: React.UIEvent<HTMLInputElement>) => {
      updateCaret();
      onScroll?.(e);
    };

    return (
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          flex: 1,
          minWidth: 0,
        }}
      >
        <input
          ref={setRef}
          value={value}
          onChange={onChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onSelect={updateCaret}
          onScroll={handleScrollEvent}
          onCompositionStart={handleCompositionStartEvent}
          onCompositionEnd={handleCompositionEndEvent}
          className={className ? `custom-caret-input ${className}` : "custom-caret-input"}
          style={{ ...style, caretColor: "transparent" }}
          {...props}
        />
        {caret.visible && (
          <span
            className="custom-caret"
            style={{
              position: "absolute",
              left: caret.left,
              top: caret.top,
              width: caret.width,
              height: caret.height,
              borderRadius: 9999,
              backgroundColor: "var(--muted-foreground)",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
    );
  },
);

function measureText(text: string, font: string): number {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  ctx.font = font;
  return ctx.measureText(text).width;
}
