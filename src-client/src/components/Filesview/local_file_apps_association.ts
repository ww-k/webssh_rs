import i18n from "@/i18n";

const ImgPreview = {
    id: "imgpreview",
    name: i18n.t("files_app_image_preview"),
    localOpen: true,
};
export default {
    ".png": [ImgPreview],
    ".jpg": [ImgPreview],
};
