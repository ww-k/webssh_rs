import * as monaco from "../../../node_modules/monaco-editor/esm/vs/editor/editor.api.js";
import "../../../node_modules/monaco-editor/esm/vs/editor/editor.main.js";
import { useEffect, useRef } from "react";

import useAppStore from "@/store";

import "./FilePreview.css";

type Props = {
    fileName: string;
    content: string;
    lineWrapping: boolean;
    readOnly?: boolean;
    lineNumberOffset?: number;
    followTail?: boolean;
    showLineNumbers?: boolean;
    highlightText?: string;
    onChange?: (content: string) => void;
};

type MonacoEnvironment = {
    getWorker: (workerId: string, label: string) => Worker;
};

configureMonacoWorkers();

export default function MonacoTextEditor({
    fileName,
    content,
    lineWrapping,
    readOnly = false,
    lineNumberOffset = 0,
    followTail = false,
    showLineNumbers = true,
    highlightText = "",
    onChange,
}: Props) {
    const theme = useAppStore((state) => state.theme);
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor>();
    const onChangeRef = useRef(onChange);
    const externalUpdateRef = useRef(false);
    const highlightDecorationsRef = useRef<string[]>([]);

    onChangeRef.current = onChange;

    // Keep the model stable while streamed or paginated content changes.
    // biome-ignore lint/correctness/useExhaustiveDependencies: model lifecycle is controlled by file and mode
    useEffect(() => {
        if (!containerRef.current) return;

        const model = monaco.editor.createModel(content, getLanguage(fileName));
        const editor = monaco.editor.create(containerRef.current, {
            ariaLabel: fileName,
            automaticLayout: true,
            bracketPairColorization: { enabled: true },
            folding: !readOnly,
            fontSize: 14,
            lineNumbers: getLineNumbers(lineNumberOffset, showLineNumbers),
            minimap: { enabled: false },
            model,
            readOnly,
            scrollBeyondLastLine: false,
            scrollbar: {
                horizontalScrollbarSize: 10,
                useShadows: false,
                verticalScrollbarSize: 10,
            },
            tabSize: 4,
            wordWrap: lineWrapping ? "on" : "off",
        });
        editorRef.current = editor;
        if (followTail) {
            requestAnimationFrame(() => {
                editor.setScrollTop(editor.getScrollHeight());
            });
        }

        const contentSubscription = editor.onDidChangeModelContent(() => {
            if (!externalUpdateRef.current) {
                onChangeRef.current?.(editor.getValue());
            }
        });

        return () => {
            contentSubscription.dispose();
            editor.dispose();
            model.dispose();
            editorRef.current = undefined;
        };
    }, [fileName, followTail, readOnly, showLineNumbers]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor || editor.getValue() === content) return;
        externalUpdateRef.current = true;
        editor.setValue(content);
        externalUpdateRef.current = false;
        if (followTail) {
            requestAnimationFrame(() => {
                editor.setScrollTop(editor.getScrollHeight());
            });
        }
    }, [content, followTail]);

    useEffect(() => {
        editorRef.current?.updateOptions({
            lineNumbers: getLineNumbers(lineNumberOffset, showLineNumbers),
            wordWrap: lineWrapping ? "on" : "off",
        });
    }, [lineNumberOffset, lineWrapping, showLineNumbers]);

    useEffect(() => {
        const editor = editorRef.current;
        const model = editor?.getModel();
        if (!editor || !model || model.getValue() !== content) return;

        const decorations: monaco.editor.IModelDeltaDecoration[] = [];
        if (highlightText) {
            for (
                let lineNumber = 1;
                lineNumber <= model.getLineCount();
                lineNumber++
            ) {
                const lineContent = model.getLineContent(lineNumber);
                let index = lineContent.indexOf(highlightText);
                while (index >= 0) {
                    decorations.push({
                        range: new monaco.Range(
                            lineNumber,
                            index + 1,
                            lineNumber,
                            index + highlightText.length + 1,
                        ),
                        options: {
                            inlineClassName: "filesviewFileEditorHighlight",
                        },
                    });
                    index = lineContent.indexOf(
                        highlightText,
                        index + highlightText.length,
                    );
                }
            }
        }
        highlightDecorationsRef.current = editor.deltaDecorations(
            highlightDecorationsRef.current,
            decorations,
        );

        return () => {
            if (editorRef.current === editor) {
                highlightDecorationsRef.current = editor.deltaDecorations(
                    highlightDecorationsRef.current,
                    [],
                );
            }
        };
    }, [content, highlightText]);

    useEffect(() => {
        monaco.editor.setTheme(theme === "dark" ? "vs-dark" : "vs");
    }, [theme]);

    return (
        <div
            ref={containerRef}
            className="filesviewFileEditorMonaco"
            aria-label={fileName}
        />
    );
}

function configureMonacoWorkers() {
    const global = globalThis as typeof globalThis & {
        MonacoEnvironment?: MonacoEnvironment;
    };
    if (global.MonacoEnvironment) return;

    global.MonacoEnvironment = {
        getWorker(_workerId, label) {
            if (label === "json") {
                return new Worker(
                    new URL(
                        "../../../node_modules/monaco-editor/esm/vs/language/json/json.worker.js",
                        import.meta.url,
                    ),
                    { type: "module" },
                );
            }
            return new Worker(
                new URL(
                    "../../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js",
                    import.meta.url,
                ),
                { type: "module" },
            );
        },
    };
}

function getLineNumbers(offset: number, showLineNumbers: boolean) {
    if (!showLineNumbers) return "off";
    return offset > 0
        ? (lineNumber: number) => String(offset + lineNumber)
        : "on";
}

function getLanguage(fileName: string): string | undefined {
    const name = fileName.toLowerCase();
    if (name.endsWith(".json") || name.endsWith(".jsonc")) return "json";
    if (name.endsWith(".yaml") || name.endsWith(".yml")) return "yaml";
    if (name.endsWith(".xml")) return "xml";
    if (name.endsWith(".py")) return "python";
    return undefined;
}
