import classNames from "clsx";
import { forwardRef } from "react";

import type { HTMLAttributes, ReactElement, ReactNode, Ref } from "react";

import "./index.css";

export interface PageLayoutProps extends HTMLAttributes<HTMLElement> {
    header?: ReactNode;
    toolbar?: ReactNode;
    contentRef?: Ref<HTMLDivElement>;
    contentProps?: HTMLAttributes<HTMLDivElement>;
}

const PageLayout = forwardRef<HTMLElement, PageLayoutProps>(function PageLayout(
    {
        className,
        children,
        header,
        toolbar,
        contentRef,
        contentProps,
        ...props
    },
    ref,
): ReactElement {
    const { className: contentClassName, ...restContentProps } =
        contentProps ?? {};
    const hasHeader = header !== undefined || toolbar !== undefined;

    return (
        <main
            className={classNames("WebSSH-PageLayout", className)}
            ref={ref}
            {...props}
        >
            {hasHeader && (
                <header className="WebSSH-PageLayoutHeader">
                    {header !== undefined && (
                        <div className="WebSSH-PageLayoutHeader-filter">
                            {header}
                        </div>
                    )}
                    {toolbar !== undefined && (
                        <div className="WebSSH-PageLayoutHeader-toolbar">
                            {toolbar}
                        </div>
                    )}
                </header>
            )}
            <div
                className={classNames(
                    "WebSSH-PageLayoutContent",
                    contentClassName,
                )}
                ref={contentRef}
                {...restContentProps}
            >
                {children}
            </div>
        </main>
    );
});

export default PageLayout;
