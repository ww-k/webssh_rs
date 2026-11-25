import { toast } from "@ui-sdk/react/toast";
import { Check, Info, Plus, Search, Sparkles } from "lucide-react";
import { useState } from "react";

import Button from "@/components/Button";
import { AppDialog, DialogAction } from "@/components/Dialog";
import Input from "@/components/Input";
import Loading from "@/components/Loading";
import Progress from "@/components/Progress";
import Select from "@/components/Select";
import Tooltip from "@/components/Tooltip";

import "./index.css";

const selectOptions = [
    { label: "Development", value: "development" },
    { label: "Staging", value: "staging" },
    { label: "Production", value: "production" },
    { label: "Unavailable", value: "unavailable", disabled: true },
];

export default function UiComponentShowcase() {
    const [inputValue, setInputValue] = useState("workspace");
    const [password, setPassword] = useState("ssh-secret");
    const [environment, setEnvironment] = useState<string | null>("staging");
    const [progress, setProgress] = useState(68);
    const [loading, setLoading] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);

    const showToast = (type: "success" | "info" | "warning" | "error") => {
        const messages = {
            success: "Connection profile saved",
            info: "A new session is ready",
            warning: "The session expires soon",
            error: "Could not connect to the server",
        };
        toast[type](messages[type]);
    };

    return (
        <main className="UiComponentShowcase">
            <header className="UiComponentShowcaseHeader">
                <div>
                    <p className="UiComponentShowcaseEyebrow">
                        ui-sdk component lab
                    </p>
                    <h1>WebSSH interface components</h1>
                    <p className="UiComponentShowcaseIntro">
                        The reusable controls used across the desktop and
                        browser experience, collected in one place for quick
                        review.
                    </p>
                </div>
                <div className="UiComponentShowcaseMeta">
                    <span>7 components</span>
                    <span className="UiComponentShowcaseMetaDot" />
                    <span>Interactive examples</span>
                </div>
            </header>

            <div className="UiComponentShowcaseGrid">
                <section className="UiComponentCard UiComponentCardWide">
                    <div className="UiComponentCardHeading">
                        <div>
                            <p className="UiComponentCardKicker">
                                01 / Actions
                            </p>
                            <h2>Button</h2>
                        </div>
                        <span className="UiComponentCardSource">
                            components/Button
                        </span>
                    </div>
                    <p className="UiComponentCardDescription">
                        Consistent action hierarchy with loading, danger,
                        icon-only, and block states.
                    </p>
                    <div className="UiComponentExampleStack">
                        <div className="UiComponentExampleRow UiComponentButtonRow">
                            <Button type="primary" icon={<Plus size={16} />}>
                                New connection
                            </Button>
                            <Button>Secondary</Button>
                            <Button type="dashed">Dashed</Button>
                            <Button type="text">Text action</Button>
                            <Button type="link">Link action</Button>
                        </div>
                        <div className="UiComponentExampleRow UiComponentButtonRow">
                            <Button type="primary" danger>
                                Delete target
                            </Button>
                            <Button loading type="primary">
                                Saving
                            </Button>
                            <Button disabled>Disabled</Button>
                            <Tooltip title="Refresh connection list">
                                <Button
                                    aria-label="Refresh connection list"
                                    icon={<Sparkles size={16} />}
                                />
                            </Tooltip>
                        </div>
                    </div>
                </section>

                <section className="UiComponentCard">
                    <div className="UiComponentCardHeading">
                        <div>
                            <p className="UiComponentCardKicker">02 / Forms</p>
                            <h2>Input</h2>
                        </div>
                        <span className="UiComponentCardSource">
                            components/Input
                        </span>
                    </div>
                    <p className="UiComponentCardDescription">
                        Text, password, textarea, prefix, suffix, and clearable
                        input variants.
                    </p>
                    <div className="UiComponentFormStack">
                        <label>
                            <span>Search workspace</span>
                            <Input
                                allowClear
                                prefix={<Search size={15} />}
                                value={inputValue}
                                onChange={(event) =>
                                    setInputValue(event.target.value)
                                }
                                placeholder="Type a workspace name"
                            />
                        </label>
                        <label>
                            <span>Passphrase</span>
                            <Input.Password
                                value={password}
                                onChange={(event) =>
                                    setPassword(event.target.value)
                                }
                                placeholder="Enter passphrase"
                            />
                        </label>
                        <label>
                            <span>Notes</span>
                            <Input.TextArea
                                defaultValue="Keep this host available for the team."
                                rows={2}
                            />
                        </label>
                    </div>
                </section>

                <section className="UiComponentCard">
                    <div className="UiComponentCardHeading">
                        <div>
                            <p className="UiComponentCardKicker">03 / Forms</p>
                            <h2>Select</h2>
                        </div>
                        <span className="UiComponentCardSource">
                            components/Select
                        </span>
                    </div>
                    <p className="UiComponentCardDescription">
                        Keyboard-friendly selection with search, clear,
                        disabled, and empty states.
                    </p>
                    <div className="UiComponentFormStack">
                        <label>
                            <span>Environment</span>
                            <Select
                                aria-label="Environment"
                                allowClear
                                showSearch
                                options={selectOptions}
                                value={environment}
                                onChange={setEnvironment}
                                placeholder="Choose an environment"
                            />
                        </label>
                        <div className="UiComponentValuePreview">
                            <span>Selected value</span>
                            <strong>{environment ?? "None"}</strong>
                        </div>
                    </div>
                </section>

                <section className="UiComponentCard">
                    <div className="UiComponentCardHeading">
                        <div>
                            <p className="UiComponentCardKicker">
                                04 / Feedback
                            </p>
                            <h2>Tooltip & Toast</h2>
                        </div>
                        <span className="UiComponentCardSource">
                            components/Tooltip
                        </span>
                    </div>
                    <p className="UiComponentCardDescription">
                        Compact guidance for controls and global status messages
                        through the shared overlay host.
                    </p>
                    <div className="UiComponentExampleStack">
                        <div className="UiComponentExampleRow">
                            <Tooltip title="The connection stays open while this is enabled">
                                <Button icon={<Info size={16} />}>
                                    Hover for details
                                </Button>
                            </Tooltip>
                        </div>
                        <div className="UiComponentToastGrid">
                            <Button
                                size="small"
                                onClick={() => showToast("success")}
                            >
                                Success
                            </Button>
                            <Button
                                size="small"
                                onClick={() => showToast("info")}
                            >
                                Info
                            </Button>
                            <Button
                                size="small"
                                onClick={() => showToast("warning")}
                            >
                                Warning
                            </Button>
                            <Button
                                size="small"
                                danger
                                onClick={() => showToast("error")}
                            >
                                Error
                            </Button>
                        </div>
                    </div>
                </section>

                <section className="UiComponentCard UiComponentCardWide">
                    <div className="UiComponentCardHeading">
                        <div>
                            <p className="UiComponentCardKicker">
                                05 / Feedback
                            </p>
                            <h2>Progress & Loading</h2>
                        </div>
                        <span className="UiComponentCardSource">
                            components/Progress · Loading
                        </span>
                    </div>
                    <p className="UiComponentCardDescription">
                        Show long-running transfer work with status colors and
                        an indeterminate loading state.
                    </p>
                    <div className="UiComponentProgressLayout">
                        <div className="UiComponentProgressMain">
                            <div className="UiComponentProgressLabel">
                                <span>Uploading terminal logs</span>
                                <strong>{progress}%</strong>
                            </div>
                            <Progress value={progress} status="active" />
                            <input
                                aria-label="Progress value"
                                className="UiComponentRange"
                                type="range"
                                min="0"
                                max="100"
                                value={progress}
                                onChange={(event) =>
                                    setProgress(Number(event.target.value))
                                }
                            />
                            <div className="UiComponentProgressVariants">
                                <div>
                                    <span>Success</span>
                                    <Progress
                                        value={100}
                                        status="success"
                                        size="small"
                                    />
                                </div>
                                <div>
                                    <span>Exception</span>
                                    <Progress
                                        value={42}
                                        status="exception"
                                        size="small"
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="UiComponentLoadingDemo">
                            <Loading
                                spinning={loading}
                                tip={loading ? "Connecting" : undefined}
                            />
                            <Button
                                type={loading ? "default" : "primary"}
                                onClick={() => setLoading((value) => !value)}
                            >
                                {loading ? "Stop loading" : "Start loading"}
                            </Button>
                        </div>
                    </div>
                </section>

                <section className="UiComponentCard">
                    <div className="UiComponentCardHeading">
                        <div>
                            <p className="UiComponentCardKicker">
                                06 / Overlays
                            </p>
                            <h2>Dialog</h2>
                        </div>
                        <span className="UiComponentCardSource">
                            components/Dialog
                        </span>
                    </div>
                    <p className="UiComponentCardDescription">
                        Focus-managed modal content with a reusable footer and
                        close action.
                    </p>
                    <div className="UiComponentDialogPreview">
                        <div className="UiComponentDialogIcon">
                            <Check size={18} />
                        </div>
                        <div>
                            <strong>Connection details</strong>
                            <span>
                                Review a host before opening a terminal.
                            </span>
                        </div>
                    </div>
                    <Button type="primary" onClick={() => setDialogOpen(true)}>
                        Open dialog
                    </Button>
                    <AppDialog
                        open={dialogOpen}
                        title="Open terminal session"
                        onCancel={() => setDialogOpen(false)}
                        footer={
                            <>
                                <DialogAction
                                    onClick={() => setDialogOpen(false)}
                                >
                                    Cancel
                                </DialogAction>
                                <DialogAction
                                    primary
                                    onClick={() => {
                                        setDialogOpen(false);
                                        toast.success(
                                            "Terminal session opened",
                                        );
                                    }}
                                >
                                    Continue
                                </DialogAction>
                            </>
                        }
                    >
                        <p className="UiComponentDialogBodyText">
                            You are about to connect to{" "}
                            <strong>staging-web-01</strong>. The current profile
                            uses the selected environment and saved passphrase.
                        </p>
                    </AppDialog>
                </section>
            </div>
        </main>
    );
}
