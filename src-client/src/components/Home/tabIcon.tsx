import {
    CodeOutlined,
    DesktopOutlined,
    FolderOutlined,
} from "@ant-design/icons";

export default function getTabIcon(path: string) {
    if (path.startsWith("/terminal/")) {
        return <CodeOutlined aria-hidden="true" />;
    }
    if (path.startsWith("/filesview/")) {
        return <FolderOutlined aria-hidden="true" />;
    }
    return <DesktopOutlined aria-hidden="true" />;
}
