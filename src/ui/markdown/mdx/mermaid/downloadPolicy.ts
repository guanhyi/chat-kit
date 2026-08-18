export const MINDMAP_DOWNLOAD_FORMATS = ['png'] as const
export const MINDMAP_DOWNLOAD_LABEL = '下载 PNG'
export const MINDMAP_DOWNLOAD_FAILURE_MESSAGE = 'PNG 生成失败，请稍后重试'

export const mindmapDownloadFailureMessage = (downloaded: boolean) => (
    downloaded ? null : MINDMAP_DOWNLOAD_FAILURE_MESSAGE
)
