const rootTag = "";
const doctypeTag = "!doctype";
const doctypePrefix = "<!doctype";
const commentStart = "<!--";
const commentEnd = "-->";

const voidElements = ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",];
const rawTextElements = ["script", "style", "textarea"];
const whitespaceCharacters = [" ", "\n", "\t", "\r", "\f"];
const nameTerminators = [...whitespaceCharacters, "=", ">", "/"];
const unquotedValueTerminators = [...whitespaceCharacters, ">"];

const isLetter = (character) => (character >= "a" && character <= "z") || (character >= "A" && character <= "Z");
const getLineNumber = (htmlText, index) => htmlText.slice(0, index).split("\n").length;
const isWhitespace = (character) => whitespaceCharacters.includes(character);


// The html2json and convertHtml2JsonAndSet was replaced to the bootom of this file

const normalizeContent = (text) =>
  whitespaceCharacters
    .reduce((spacedText, character) => spacedText.split(character).join(" "), text)
    .split(" ")
    .filter((word) => word !== "")
    .join(" ");

const skipWhitespace = (htmlText, position) =>
  isWhitespace(htmlText[position])
    ? skipWhitespace(htmlText, position + 1)
    : position;

const findNameEnd = (htmlText, position) => {
  const character = htmlText[position];
  const isNameEnd = character === undefined || nameTerminators.includes(character);

  return isNameEnd ? position : findNameEnd(htmlText, position + 1);
};

const findUnquotedValueEnd = (htmlText, position) => {
  const character = htmlText[position];
  const isValueEnd = character === undefined || unquotedValueTerminators.includes(character);

  return isValueEnd ? position : findUnquotedValueEnd(htmlText, position + 1);
};

const findRawTextClosingStart = (htmlText, position, tag) => {
  const candidateStart = htmlText.indexOf("</", position);
  const candidateTag = htmlText
    .slice(candidateStart + 2, candidateStart + 2 + tag.length)
    .toLowerCase();
  const isNotFound = candidateStart === -1;
  const isClosingTag = candidateTag === tag;

  return isNotFound || isClosingTag
    ? candidateStart
    : findRawTextClosingStart(htmlText, candidateStart + 2, tag);
};

const createNode = (line, tag, entries, content, children) => {
  const attributes = entries.reduce(
    (result, [name, value]) => ({ ...result, [name]: value }),
    {}
  );

  return { line, tag, attributes, content, children };
};


//Element Parsing Functions

const parseAttributeValue = (htmlText, position) => {
  const quote = htmlText[position];
  const isQuoted = quote === '"' || quote === "'";
  const closingQuoteIndex = isQuoted ? htmlText.indexOf(quote, position + 1) : -1;
  const unquotedEnd = findUnquotedValueEnd(htmlText, position);
  const isQuotedValueClosed = isQuoted && closingQuoteIndex !== -1;
  const isUnquotedValuePresent = !isQuoted && unquotedEnd > position;

  if (isQuotedValueClosed) {
    return {
      value: htmlText.slice(position + 1, closingQuoteIndex),
      position: closingQuoteIndex + 1,
    };
  }

  return isUnquotedValuePresent
    ? { value: htmlText.slice(position, unquotedEnd), position: unquotedEnd }
    : undefined;
};

const parseAttributes = (htmlText, position, entries) => {
  const nameStart = skipWhitespace(htmlText, position);
  const character = htmlText[nameStart];
  const isTagEnd = character === ">";
  const isSelfClosingEnd = character === "/" && htmlText[nameStart + 1] === ">";
  const nameEnd = findNameEnd(htmlText, nameStart);
  const isNameMissing = nameEnd === nameStart;

  if (isTagEnd) return { entries, position: nameStart + 1, isSelfClosing: false };
  if (isSelfClosingEnd) return { entries, position: nameStart + 2, isSelfClosing: true };
  if (isNameMissing) return undefined;

  const name = htmlText.slice(nameStart, nameEnd).toLowerCase();
  const equalsIndex = skipWhitespace(htmlText, nameEnd);
  const hasValue = htmlText[equalsIndex] === "=";
  const valueStart = skipWhitespace(htmlText, equalsIndex + 1);
  const parsedValue = hasValue
    ? parseAttributeValue(htmlText, valueStart)
    : { value: "", position: nameEnd };
  const isDuplicate = entries.some(([entryName]) => entryName === name);

  if (parsedValue === undefined) return undefined;

  return parseAttributes(
    htmlText,
    parsedValue.position,
    isDuplicate ? entries : [...entries, [name, parsedValue.value]]
  );
};

const parseElement = (htmlText, tagStart) => {
  const nameStart = tagStart + 1;
  const nameEnd = findNameEnd(htmlText, nameStart);
  const tag = htmlText.slice(nameStart, nameEnd).toLowerCase();
  const openingTag = parseAttributes(htmlText, nameEnd, []);

  if (openingTag === undefined) return undefined;

  const { entries, position: contentStart, isSelfClosing } = openingTag;
  const line = getLineNumber(htmlText, tagStart);
  const isVoidElement = voidElements.includes(tag) || isSelfClosing;
  const isRawTextElement = rawTextElements.includes(tag);

  if (isVoidElement) {
    return { node: createNode(line, tag, entries, "", []), position: contentStart };
  }

  if (isRawTextElement) {
    const closingStart = findRawTextClosingStart(htmlText, contentStart, tag);
    const closingEnd = closingStart === -1 ? -1 : htmlText.indexOf(">", closingStart);
    const closingRest = htmlText
      .slice(closingStart + 2 + tag.length, closingEnd)
      .trim();
    const isClosingValid = closingEnd !== -1 && closingRest === "";

    return isClosingValid
      ? {
        node: createNode(
          line,
          tag,
          entries,
          normalizeContent(htmlText.slice(contentStart, closingStart)),
          []
        ),
        position: closingEnd + 1,
      }
      : undefined;
  }

  const parsedChildren = parseChildren(htmlText, contentStart, tag, [], []);

  return parsedChildren === undefined
    ? undefined
    : {
      node: createNode(
        line,
        tag,
        entries,
        parsedChildren.content,
        parsedChildren.children
      ),
      position: parsedChildren.position,
    };
};

const parseChildren = (htmlText, position, parentTag, children, contentParts) => {
  const tagStart = htmlText.indexOf("<", position);
  const isTextLast = tagStart === -1;
  const textEnd = isTextLast ? htmlText.length : tagStart;
  const text = normalizeContent(htmlText.slice(position, textEnd));
  const isRoot = parentTag === rootTag;
  const isTextOutsideElement = isRoot && text !== "";
  const nextContentParts = text === "" ? contentParts : [...contentParts, text];

  if (isTextOutsideElement) return undefined;

  if (isTextLast) {
    return isRoot
      ? { children, content: nextContentParts.join(" "), position: htmlText.length }
      : undefined;
  }

  const isComment = htmlText.startsWith(commentStart, tagStart);
  const isDoctype = htmlText.slice(tagStart, tagStart + doctypePrefix.length).toLowerCase() === doctypePrefix;
  const isClosingTag = htmlText.startsWith("</", tagStart);
  const isOpeningTag = isLetter(htmlText[tagStart + 1]);

  if (isComment) {
    const commentEndIndex = htmlText.indexOf(commentEnd, tagStart + commentStart.length);

    return commentEndIndex === -1
      ? undefined
      : parseChildren(
        htmlText,
        commentEndIndex + commentEnd.length,
        parentTag,
        children,
        nextContentParts
      );
  }

  if (isDoctype) {
    const doctypeEnd = htmlText.indexOf(">", tagStart);
    const doctypeEntries = normalizeContent(
      htmlText.slice(tagStart + doctypePrefix.length, doctypeEnd)
    )
      .split(" ")
      .filter((word) => word !== "")
      .map((word) => [word, ""]);
    const doctypeNode = createNode(
      getLineNumber(htmlText, tagStart),
      doctypeTag,
      doctypeEntries,
      "",
      []
    );

    return doctypeEnd === -1
      ? undefined
      : parseChildren(
        htmlText,
        doctypeEnd + 1,
        parentTag,
        [...children, doctypeNode],
        nextContentParts
      );
  }

  if (isClosingTag) {
    const closingEnd = htmlText.indexOf(">", tagStart);
    const closingTag = htmlText
      .slice(tagStart + 2, closingEnd)
      .trim()
      .toLowerCase();
    const isClosingMatching = closingEnd !== -1 && !isRoot && closingTag === parentTag;

    return isClosingMatching
      ? {
        children,
        content: nextContentParts.join(" "),
        position: closingEnd + 1,
      }
      : undefined;
  }

  if (isOpeningTag) {
    const element = parseElement(htmlText, tagStart);

    return element === undefined
      ? undefined
      : parseChildren(
        htmlText,
        element.position,
        parentTag,
        [...children, element.node],
        nextContentParts
      );
  }

  return undefined;
};


// Inputs to the functions are located in ./html_samples/samples.js as queries to the DOM

const html2json = (htmlText) => {
  const parsedRoot = parseChildren(htmlText, 0, rootTag, [], []);

  return parsedRoot === undefined ? undefined : parsedRoot.children;
};

const convertHtml2JsonAndSet = () => {
  const htmlTextAreaValue = document.querySelector("#html").value;
  const jsonObj = html2json(htmlTextAreaValue);
  const isValidMarkup = jsonObj !== undefined;
  const jsonArea = document.querySelector("#json");

  if (!isValidMarkup) return;

  jsonArea.textContent = JSON.stringify(jsonObj, null, 2);
};