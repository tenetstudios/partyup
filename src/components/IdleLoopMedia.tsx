import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import type { RoomIdleMedia } from "../lib/roomIdleMedia";

function IdleVideo({ media }: { media: RoomIdleMedia }) {
  const player = useVideoPlayer(media.signed_url, (instance) => {
    instance.loop = true;
    instance.muted = true;
    instance.play();
  });

  return (
    <VideoView
      contentFit="cover"
      nativeControls={false}
      player={player}
      style={styles.media}
      surfaceType="textureView"
    />
  );
}

export default function IdleLoopMedia({ media }: { media: RoomIdleMedia }) {
  const opacity = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    Animated.timing(opacity, { duration: 220, toValue: 1, useNativeDriver: true }).start();
  }, [opacity, media.signed_url]);

  return (
    <Animated.View style={[styles.frame, { opacity }]}>
      {media.media_type === "video" ? (
        <IdleVideo media={media} />
      ) : (
        <Image contentFit="cover" source={{ uri: media.signed_url }} style={styles.media} />
      )}
      <View style={styles.shade} />
      <View style={styles.badge}>
        <Text style={styles.badgeText}>HIGHLIGHTS</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  frame: { backgroundColor: "#050509", flex: 1, minHeight: 260, overflow: "hidden", position: "relative" },
  media: { height: "100%", width: "100%" },
  shade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.08)" },
  badge: { backgroundColor: "rgba(13,13,20,0.82)", borderRadius: 999, left: 12, paddingHorizontal: 11, paddingVertical: 7, position: "absolute", top: 12 },
  badgeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900", letterSpacing: 0.7 },
});
