import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import type { AudioAdapter } from "./playerStore";

export class ExpoAudioAdapter implements AudioAdapter {
  private player: AudioPlayer | null = null;

  async load(uri: string) {
    this.release();
    this.player = createAudioPlayer({ uri });
  }

  async play() {
    this.player?.play();
  }

  async pause() {
    this.player?.pause();
  }

  release() {
    this.player?.pause();
    this.player?.remove();
    this.player = null;
  }
}
