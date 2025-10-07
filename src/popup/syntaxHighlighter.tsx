import React, { useMemo } from "react";

interface SyntaxHighlighterProps {
  text: string;
  currentWordIndex: number;
  isSpeaking: boolean;
  onChange: (text: string) => void;
  theme: "light" | "dark";
}

interface WordToken {
  word: string;
  index: number;
  type: "word" | "punctuation" | "number" | "whitespace";
  start: number;
  end: number;
}

const SyntaxHighlighter: React.FC<SyntaxHighlighterProps> = ({
  text,
  currentWordIndex,
  isSpeaking,
  onChange,
  theme,
}) => {
  // Tokenize text into words with metadata
  const tokens = useMemo((): WordToken[] => {
    if (!text) return [];

    const tokens: WordToken[] = [];
    let wordIndex = 0;
    let charIndex = 0;

    // Split by words while preserving whitespace and punctuation
    const regex = /(\S+|\s+)/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const token = match[1];
      const start = charIndex;
      const end = charIndex + token.length;

      if (token.trim()) {
        // Non-whitespace token - determine type
        let type: "word" | "punctuation" | "number";

        if (/^\d+(\.\d+)?$/.test(token)) {
          // Pure numbers (including decimals)
          type = "number";
        } else if (/^[^\w\s]+$/.test(token)) {
          // Pure punctuation
          type = "punctuation";
        } else {
          // Contains letters - treat as word
          type = "word";
        }

        tokens.push({
          word: token,
          index: type === "word" ? wordIndex++ : -1,
          type,
          start,
          end,
        });
      } else {
        // Whitespace token
        tokens.push({
          word: token,
          index: -1,
          type: "whitespace",
          start,
          end,
        });
      }

      charIndex = end;
    }

    return tokens;
  }, [text]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  // Render highlighted version for display
  const renderHighlighted = () => {
    return tokens.map((token, i) => {
      const isCurrentWord =
        token.type === "word" && token.index === currentWordIndex && isSpeaking;
      const className = `token token-${token.type} ${isCurrentWord ? "current-word" : ""}`;

      return (
        <span key={i} className={className} data-word-index={token.index}>
          {token.word}
        </span>
      );
    });
  };

  return (
    <div className={`syntax-highlighter-container theme-${theme}`}>
      {/* Highlighted overlay */}
      <div className="syntax-highlight-overlay" aria-hidden="true">
        <div className="syntax-content">{renderHighlighted()}</div>
      </div>

      {/* Actual textarea for input */}
      <textarea
        value={text}
        onChange={handleTextChange}
        placeholder="Selected text will appear here. You can also type or paste text directly."
        aria-label="Text to read"
        className="syntax-textarea"
        spellCheck={false}
      />
    </div>
  );
};

export default SyntaxHighlighter;
