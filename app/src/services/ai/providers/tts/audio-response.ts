/** 两套语音协议共用二进制校验，错误正文不得泄露网关详情或写成MP3。 */
export async function readMP3AudioResponse(
  response: Response,
  label: string
): Promise<Buffer> {
  if (!response.ok)
    throw new Error(
      `${label}语音合成失败（HTTP ${response.status}），请检查语音模型、密钥与上游服务`
    );
  const contentType = response.headers.get("Content-Type")?.toLowerCase() || "";
  const genericBinary =
    !contentType || contentType.startsWith("application/octet-stream");
  if (!contentType.startsWith("audio/") && !genericBinary)
    throw new Error(`${label}未返回音频数据，请检查语音接口地址和上游服务`);
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) throw new Error(`${label}返回的音频为空`);
  // 通用二进制或缺少类型时，再检查ID3标签/MP3帧头，不能只看HTTP 200。
  const hasMP3Header =
    audio.length >= 3 &&
    ((audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33) ||
      (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0));
  if (genericBinary && !hasMP3Header)
    throw new Error(`${label}返回的数据不是可识别的MP3音频`);
  return audio;
}
