import { RefObject, useEffect } from 'react';
import { getCurrentLine, wouldCreateConsecutiveSpaces, NotAlphanumericRegex, getPreviousSpace, getNextSpace, getWordStartPosition } from '../utils';

export function useEditorEvents(
    contentToCopy: string | undefined,
    setContentToCopy: (content: string | undefined) => void,
    writerRef: RefObject<HTMLDivElement>,
    errorRef: RefObject<HTMLDivElement>,
    settings: Record<string, any>
) {
    useEffect(() => {
        const onClick = contentToCopy
            ? (e: MouseEvent) => {
                  const target = e.target as HTMLElement;
                  
                  if (target.classList.contains('word') && writerRef.current) {
                      e.preventDefault();
                      e.stopPropagation();
                      
                      const position = getWordStartPosition(contentToCopy, target);
                      const textBefore = contentToCopy.substring(0, position);
                      
                      writerRef.current.innerHTML = textBefore;
                      writerRef.current.focus();
                      
                      const selection = window.getSelection();
                      const range = document.createRange();
                      range.selectNodeContents(writerRef.current);
                      range.collapse(false);
                      selection?.removeAllRanges();
                      selection?.addRange(range);
                      
                      return;
                  }
                  
                  if (target?.dataset?.editor || target?.dataset?.dontstealfocus) return;
                  if (!writerRef.current) return;

                  const range = document.createRange();
                  range.selectNodeContents(writerRef.current);
                  range.collapse(false);

                  const selection = window.getSelection();
                  if (!selection) return;
                  
                  selection.removeAllRanges();
                  selection.addRange(range);
              }
            : undefined;

        const onPaste = contentToCopy
            ? (e: Event) => {
                  e.preventDefault();
                  e.stopPropagation();
              }
            : (e: ClipboardEvent) => {
                  const target = e.target as HTMLElement;
                  if (target?.dataset?.dontstealfocus) return;

                  e.preventDefault();
                  e.stopPropagation();

                  const clipboardData = e.clipboardData || window.clipboardData;
                  if (!clipboardData) return;

                  const pastedData = clipboardData
                      .getData('Text')
                      .replace(/ +/g, ' ')
                      .replace(/\t/g, '')
                      .replace(/\r/g, '')
                      .replace(/\n{1,}/g, '\n\n')
                      .trim();
                  
                  if (pastedData.length < 1) return;

                  setContentToCopy(pastedData);
                  setTimeout(() => writerRef.current?.focus(), 100);
              };

        const onKeydown = contentToCopy
            ? (e: KeyboardEvent) => {
                  const target = e.target as HTMLElement;
                  if (target?.dataset?.dontstealfocus) return;
                  if (e.metaKey || e.altKey || e.ctrlKey) return;
                  if (!writerRef.current) return;

                  if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();

                      const selection = window.getSelection();
                      if (!selection) return;

                      const range = selection.getRangeAt(0);
                      const currentNode = range.startContainer === writerRef.current
                          ? writerRef.current.lastChild
                          : range.startContainer;
                      
                      if (!currentNode) return;

                      // Get current position in the overall text
                      const fullText = writerRef.current.innerText;
                      const currentPosition = getTextPosition(writerRef.current, currentNode, range.startOffset);

                      // Check if we need to autocorrect the current word before inserting newline
                      if (settings.autocorrect) {
                          const lastWord = fullText.slice(getPreviousSpace(fullText, currentPosition), currentPosition);
                          if (lastWord.trim().length > 0) {
                              handleAutocorrect(e, contentToCopy, writerRef.current, false);
                          }
                      }

                      // Check if we should insert a double line break
                      const nextChars = contentToCopy.substring(currentPosition, currentPosition + 2);
                      const shouldDoubleBreak = nextChars === '\n\n';

                      // Insert the appropriate number of line breaks
                      if (shouldDoubleBreak) {
                          insertTextAtCursor('\n\n');
                      } else {
                          insertTextAtCursor('\n');
                      }

                      return;
                  }

                  if (e.key === ' ') {
                      if (!writerRef.current.textContent || wouldCreateConsecutiveSpaces(writerRef.current)) {
                          e.preventDefault();
                          e.stopPropagation();
                          return;
                      }
                  }

                  if (settings.ignore_punctuation) {
                      if (handleIgnorePunctuation(e, contentToCopy, writerRef.current)) {
                          e.preventDefault();
                          e.stopPropagation();
                          return;
                      }
                  }

                  if (settings.autocorrect && e.key === ' ') {
                      if (handleAutocorrect(e, contentToCopy, writerRef.current)) {
                          e.preventDefault();
                          e.stopPropagation();
                          return;
                      }
                  }
              }
            : undefined;

        const onKeyUp = contentToCopy
            ? () => {
                  if (!writerRef.current || !errorRef.current) return;

                  const text = writerRef.current.innerText;
                  let error: number[] | undefined;
                  const errors: number[][] = [];

                  for (let index = 0; index < text.length; index++) {
                      const letter = text[index];
                      const originalLetter = contentToCopy[index];

                      if (letter !== originalLetter) {
                          if (error === undefined) {
                              error = [index];
                              errors.push(error);
                          }
                      } else {
                          if (error !== undefined) {
                              error.push(index);
                              error = undefined;
                          }
                      }
                  }

                  if (error) {
                      error.push(text.length);
                  }

                  const letters = Array.from(text);
                  errors.forEach(([start, end]) => {
                      letters[start] = `<span>${letters[start]}`;
                      letters[end - 1] = `${letters[end - 1] || ''}</span>`;
                  });

                  errorRef.current.innerHTML = letters.join('');
              }
            : undefined;

        window.addEventListener('paste', onPaste);
        window.addEventListener('click', onClick);
        window.addEventListener('keydown', onKeydown);
        window.addEventListener('keyup', onKeyUp);

        return () => {
            window.removeEventListener('paste', onPaste);
            window.removeEventListener('click', onClick);
            window.removeEventListener('keydown', onKeydown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, [contentToCopy, setContentToCopy, settings, writerRef, errorRef]);
}

function getTextPosition(editor: Node, currentNode: Node, offset: number): number {
    let position = 0;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    
    while (node) {
        if (node === currentNode) {
            return position + offset;
        }
        position += node.textContent?.length || 0;
        node = walker.nextNode();
    }
    
    return position;
}

function insertTextAtCursor(text: string) {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    
    const range = selection.getRangeAt(0);
    const textNode = document.createTextNode(text);
    
    range.deleteContents();
    range.insertNode(textNode);
    
    // Move cursor to end of inserted text
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    selection.removeAllRanges();
    selection.addRange(range);
}

function handleIgnorePunctuation(e: KeyboardEvent, contentToCopy: string | undefined, writer: Node): boolean {
    if (!contentToCopy || !NotAlphanumericRegex.test(e.key) || e.key === ' ') {
        return false;
    }

    const selection = window.getSelection();
    if (!selection) return false;

    const range = selection.getRangeAt(0);
    const node = range.startContainer === writer ? writer.lastChild || writer : range.startContainer;
    const index = range.startContainer === writer
        ? writer.lastChild?.textContent?.length || 0
        : range.startOffset;

    const line = getCurrentLine(contentToCopy, node);
    if (!line) return false;

    const letter = line[index];
    if (!letter || !NotAlphanumericRegex.test(letter) || letter === '' || letter === '\n') {
        return false;
    }

    if (node.textContent !== null) {
        node.textContent = `${node.textContent.slice(0, index) || ''}${letter}${
            node.textContent.slice(index) || ''
        }`;

        const newRange = document.createRange();
        newRange.setStart(node, Math.min(index + 1, node.textContent.length));
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
    }

    return true;
}

function handleAutocorrect(e: KeyboardEvent, contentToCopy: string | undefined, writer: Node, addSpace = true): boolean {
    if (!contentToCopy) return false;

    const selection = window.getSelection();
    if (!selection) return false;

    const range = selection.getRangeAt(0);
    const node = range.startContainer === writer ? writer.lastChild : range.startContainer;
    if (!node || node.textContent === null) return false;

    // Get current position in the overall text
    const fullText = writer.textContent || '';
    const currentPosition = getTextPosition(writer, node, range.startOffset);

    // Get the word boundaries in the target content
    const start = getPreviousSpace(fullText, currentPosition);
    const end = getNextSpace(contentToCopy, currentPosition);

    const willAddSpace = addSpace && end < contentToCopy.length;

    const enteredWord = fullText.slice(start, currentPosition);
    const targetWord = contentToCopy.slice(start, end);

    if (enteredWord === targetWord) return false;

    // Only replace if we're at a word boundary
    if (currentPosition > start && (e.key === ' ' || currentPosition === end)) {
        // Find the correct text node to replace
        let currentNode = writer.firstChild;
        let currentOffset = 0;
        
        while (currentNode) {
            const nodeLength = currentNode.textContent?.length || 0;
            if (currentOffset + nodeLength >= start) {
                // This is the node we want to modify
                if (currentNode.nodeType === Node.TEXT_NODE) {
                    const beforeText = currentNode.textContent?.slice(0, start - currentOffset) || '';
                    const afterText = currentNode.textContent?.slice(end - currentOffset) || '';
                    
                    // Replace the content
                    currentNode.textContent = beforeText + targetWord + (willAddSpace ? ' ' : '') + afterText;
                    
                    // Set the cursor position
                    const newRange = document.createRange();
                    const newPosition = start - currentOffset + targetWord.length + (willAddSpace ? 1 : 0);
                    newRange.setStart(currentNode, Math.min(newPosition, currentNode.textContent.length));
                    newRange.collapse(true);
                    selection.removeAllRanges();
                    selection.addRange(newRange);
                    break;
                }
            }
            currentOffset += nodeLength;
            currentNode = currentNode.nextSibling;
        }
        
        return true;
    }

    return false;
}