import { Observable, Subscriber, Subscription } from "rxjs";
import { useHttp } from "./HttpContext";
import { HttpDownloadProgressEvent, HttpEventType } from "@ngify/http";

import {
  createEventStreamProcessor,
  EventSourceMessage,
  getLines,
  getMessages,
} from "./parse";
import { useRef, useState } from "react";

export type CreateEventSourceOptions = {
  api: string;
  body?: any;
  headers?: Record<string, string>;
  onMessage?: (event: EventSourceMessage, completion?: string) => any;
  onOpen?: (body: any) => any;
  isFinal?: (event: EventSourceMessage) => boolean;
  onError?: () => any;
  onFinal?: () => any;
};

export const createEventSource = (options: CreateEventSourceOptions) => {
  const http = useHttp();
  const cancelRef = useRef<Subscription>();

  const [completion, setCompletion] = useState<string>();
  const [loading, setLoading] = useState<boolean>(false);

  const onmessage = (
    event: EventSourceMessage,
    observer: Subscriber<unknown>
  ) => {
    const _completion = options.onMessage?.(event, completion);
    if (_completion) {
      setCompletion(_completion);
    }
    if (options.isFinal?.(event)) {
      setLoading(false);
      observer.next(event);
      observer.complete();
      setCompletion(undefined);
      cancel();
      return;
    }
  };

  const complete = (body: any) => {
    const processStream = createEventStreamProcessor();
    let offset = 0;
    // 累积缓冲区；统一换行符，兼容 CRLF 与一次性返回
    let buf = "";

    // 解析缓冲区中的一个或多个 SSE 事件（以空行分隔）
    const drainBuffer = (observer: Subscriber<unknown>) => {
      // 统一换行：\r\n、\r → \n，保证 "\n\n" 能正确作为事件分隔
      if (buf) buf = buf.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

      let pos = 0;
      while ((pos = buf.indexOf("\n\n")) >= 0) {
        const eventText = buf.slice(0, pos);
        buf = buf.slice(pos + 2);

        const lines = eventText.split("\n");
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }
        const dataStr = dataLines.join("\n");
        if (dataStr) {
          try {
            JSON.parse(dataStr); // 仅校验 JSON；真正的对象由上层回调解析
            onmessage(
              {
                data: dataStr,
                event: "",
                id: "",
                retry: undefined,
              },
              observer
            );
          } catch (error) {
            console.warn("Invalid JSON in event stream:", dataStr);
          }
        }
      }
    };
    return new Observable((observer) => {
      setLoading(true);
      options.onOpen?.(body);
      const _cancel = http
        ?.post(
          options.api,
          Array.isArray(body)
            ? body
            : {
                ...options.body,
                ...body,
              },
          {
            observe: "events",
            responseType: "text",
            reportProgress: true,
          }
        )
        .subscribe({
          next: (event) => {
            switch (event.type) {
              case HttpEventType.DownloadProgress:
                const progressEvent = { ...event } as HttpDownloadProgressEvent;
                const chunk = progressEvent?.partialText?.slice(offset);
                offset = progressEvent?.partialText?.length || 0;
                buf += chunk || "";
                // 解析缓冲区（可能包含多个事件）
                drainBuffer(observer);
                
                // processStream(
                //   progressEvent?.partialText || "",
                //   getLines(
                //     getMessages(
                //       (id) => {
                //         if (id) {
                //           // store the id and send it back on the next retry:
                //           // headers[LastEventId] = id;
                //         } else {
                //           // don't send the last-event-id header anymore:
                //           // delete headers[LastEventId];
                //         }
                //       },
                //       (retry) => {
                //         // retryInterval = retry;
                //       },
                //       (e) => onmessage(e, observer)
                //     )
                //   )
                // );
                break;
              case HttpEventType.Response:
                // 若此前未触发下载进度（offset===0），或确有残留缓冲，则兜底解析
                try {
                  const bodyText = (event as any)?.body as string | undefined;
                  if (bodyText && offset === 0) {
                    // 纯一次性返回：直接把 body 放入缓冲区统一拆包，避免重复
                    buf = bodyText;
                  }
                  // 解析缓冲区剩余事件
                  drainBuffer(observer);
                  // 某些后端可能不以空行结尾，这里再尝试解析最后一个 data: 块
                  if (buf && /\bdata:\s*\{/.test(buf)) {
                    const lines = buf.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
                    const dataLines: string[] = [];
                    for (const line of lines) {
                      if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
                    }
                    const dataStr = dataLines.join("\n");
                    if (dataStr) {
                      try {
                        JSON.parse(dataStr);
                        onmessage(
                          { data: dataStr, event: "", id: "", retry: undefined },
                          observer
                        );
                      } catch {}
                    }
                  }
                } catch {}

                setLoading(false);
                observer.next(event);
                setCompletion(undefined);
                observer.complete();
                break;
              // case HttpEventType.UploadProgress:
              //   console.log("f");
              //   break;
            }
          },
          error: (error) => {
            if (error.body && typeof error.body === "string") {
              try {
                let body = JSON.parse(error.body);
                setLoading(false);

                if (body.errCode != 200) {
                  // cancel();
                  observer.error({
                    ...error,
                    body: body,
                  });
                  options.onError?.();
                }

                options.onFinal?.();

                observer.next(body);
                setCompletion(undefined);
                observer.complete();
              } catch (error) {}
            }

            if (error.status === 200) {
              options.onFinal?.();
            } else {
              setLoading(false);
              observer.error(error);
              options.onError?.();
              setCompletion(undefined);
              observer.complete();
            }
            setLoading(false);
            setCompletion(undefined);

            cancel();
          },

          complete: () => {
            console.log("complete");
            options.onError?.();
            setLoading(false);
            setCompletion(undefined);
            observer.complete();
            cancelRef.current?.unsubscribe();
          },
        });

      cancelRef.current = _cancel;
    });
  };
  const cancel = () => {
    setLoading(false);

    cancelRef.current?.unsubscribe();
  };

  return {
    complete,
    cancel,
    completion,
    loading,
  };
};
