import {
    FileTextOutlined,
    ReloadOutlined,
    SearchOutlined,
} from "@ant-design/icons";
import { Button, Empty, Input, message, Select, Space, Typography } from "antd";
import {
    type ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useTranslation } from "react-i18next";

import { getServerLogs } from "@/api";

import "./index.css";

const { Text, Title } = Typography;
const LOG_LEVELS = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

const ANSI_COLORS: Record<number, string> = {
    30: "#1f1f1f",
    31: "#ff4d4f",
    32: "#52c41a",
    33: "#faad14",
    34: "#1677ff",
    35: "#eb2f96",
    36: "#13c2c2",
    37: "#f5f5f5",
    90: "#8c8c8c",
    91: "#ff7875",
    92: "#95de64",
    93: "#ffd666",
    94: "#69b1ff",
    95: "#ff85c0",
    96: "#5cdbd3",
    97: "#ffffff",
};
const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-9;?]*[ -/]*[@-~]`, "g");

function stripAnsi(text: string) {
    return text.replace(ANSI_PATTERN, "");
}

type AnsiStyle = {
    color?: string;
    backgroundColor?: string;
    fontWeight?: "bold";
    fontStyle?: "italic";
    textDecoration?: "underline" | "line-through";
    opacity?: number;
};

function renderAnsiText(text: string) {
    const style: AnsiStyle = {};
    const nodes: ReactNode[] = [];
    const ansiPattern = new RegExp(
        `${ANSI_ESCAPE}\\[([0-9;?]*)[ -/]*[@-~]`,
        "g",
    );
    let cursor = 0;
    let key = 0;

    const addText = (value: string) => {
        if (!value) return;
        nodes.push(
            <span key={key++} style={{ ...style }}>
                {value}
            </span>,
        );
    };

    while (true) {
        const match = ansiPattern.exec(text);
        if (!match) break;
        addText(text.slice(cursor, match.index));
        cursor = match.index + match[0].length;
        if (!match[0].endsWith("m")) continue;

        const codes = match[1] ? match[1].split(";").map(Number) : [0];
        for (const code of codes) {
            if (code === 0) {
                for (const property of Object.keys(
                    style,
                ) as (keyof AnsiStyle)[]) {
                    delete style[property];
                }
            } else if (code === 1) style.fontWeight = "bold";
            else if (code === 2) style.opacity = 0.65;
            else if (code === 3) style.fontStyle = "italic";
            else if (code === 4) style.textDecoration = "underline";
            else if (code === 9) style.textDecoration = "line-through";
            else if (code === 22) {
                delete style.fontWeight;
                delete style.opacity;
            } else if (code === 23) delete style.fontStyle;
            else if (code === 24 || code === 29) delete style.textDecoration;
            else if (code === 39) delete style.color;
            else if (code === 49) delete style.backgroundColor;
            else if (ANSI_COLORS[code]) style.color = ANSI_COLORS[code];
            else if (code >= 40 && code <= 47) {
                style.backgroundColor = ANSI_COLORS[code - 10];
            } else if (code >= 100 && code <= 107) {
                style.backgroundColor = ANSI_COLORS[code - 10];
            }
        }
    }
    addText(text.slice(cursor));
    return nodes;
}

export default function ServerLogs() {
    const { t } = useTranslation();
    const [logs, setLogs] = useState<string[]>([]);
    const [keyword, setKeyword] = useState("");
    const [level, setLevel] = useState<LogLevel | "ALL">("ALL");
    const [loading, setLoading] = useState(false);
    const outputRef = useRef<HTMLPreElement>(null);
    const shouldStickToBottom = useRef(true);
    const normalizedKeyword = keyword.trim().toLocaleLowerCase();
    const visibleLogs = useMemo(
        () =>
            logs.filter((line) => {
                const plainLine = stripAnsi(line);
                const lineLevel = plainLine.match(
                    /\b(TRACE|DEBUG|INFO|WARN|ERROR)\b/,
                )?.[1];
                return (
                    (level === "ALL" || lineLevel === level) &&
                    plainLine.toLocaleLowerCase().includes(normalizedKeyword)
                );
            }),
        [level, logs, normalizedKeyword],
    );

    const loadLogs = useCallback(
        async (showError = false) => {
            setLoading(true);
            try {
                setLogs(await getServerLogs());
            } catch {
                if (showError) message.error(t("server_logs_load_failed"));
            } finally {
                setLoading(false);
            }
        },
        [t],
    );

    useEffect(() => {
        void loadLogs();
        const timer = window.setInterval(() => void loadLogs(), 2000);
        return () => window.clearInterval(timer);
    }, [loadLogs]);

    useEffect(() => {
        if (
            visibleLogs.length > 0 &&
            shouldStickToBottom.current &&
            outputRef.current
        ) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
    }, [visibleLogs]);
    const logOccurrences = new Map<string, number>();
    const renderedLogs = visibleLogs.map((line, index) => {
        const occurrence = logOccurrences.get(line) ?? 0;
        logOccurrences.set(line, occurrence + 1);
        return (
            <span key={`${line}-${occurrence}`}>
                {renderAnsiText(line)}
                {index < logs.length - 1 ? "\n" : ""}
            </span>
        );
    });

    return (
        <main className="WebSSH-ServerLogs">
            <div className="WebSSH-ServerLogs-Header">
                <div>
                    <Title level={2}>{t("app_menu_server_logs")}</Title>
                </div>
                <Space>
                    <Select<LogLevel | "ALL">
                        aria-label={t("server_logs_level_filter")}
                        className="WebSSH-ServerLogs-LevelFilter"
                        onChange={setLevel}
                        options={[
                            {
                                label: t("server_logs_level_all"),
                                value: "ALL",
                            },
                            ...LOG_LEVELS.map((item) => ({
                                label: item,
                                value: item,
                            })),
                        ]}
                        value={level}
                    />
                    <Input
                        allowClear
                        className="WebSSH-ServerLogs-Filter"
                        onChange={(event) => setKeyword(event.target.value)}
                        placeholder={t("server_logs_filter_placeholder")}
                        prefix={<SearchOutlined />}
                        value={keyword}
                    />
                    <Button
                        icon={<ReloadOutlined />}
                        loading={loading}
                        onClick={() => void loadLogs(true)}
                    >
                        {t("app_btn_refresh")}
                    </Button>
                </Space>
            </div>
            <pre
                className="WebSSH-ServerLogs-Output"
                onScroll={(event) => {
                    const { scrollTop, scrollHeight, clientHeight } =
                        event.currentTarget;
                    shouldStickToBottom.current =
                        scrollHeight - scrollTop - clientHeight < 24;
                }}
                ref={outputRef}
            >
                {visibleLogs.length ? (
                    renderedLogs
                ) : logs.length ? (
                    <span className="WebSSH-ServerLogs-Empty">
                        <Empty description={t("server_logs_no_match")} />
                    </span>
                ) : (
                    <span className="WebSSH-ServerLogs-Empty">
                        <FileTextOutlined />
                        <Empty description={t("server_logs_empty")} />
                    </span>
                )}
            </pre>
        </main>
    );
}
