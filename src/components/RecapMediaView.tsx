import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { StyleSheet, View } from "react-native";
import type { RoomRecapMedia } from "../../lib/recapMedia";

function RecapVideo({ media }: { media: RoomRecapMedia }) {
  const player = useVideoPlayer(media.signed_url);

  return (
    <VideoView
      contentFit="contain"
      nativeControls
      player={player}
      style={styles.media}
      surfaceType="textureView"
    />
  );
}

export default function RecapMediaView({ media }: { media: RoomRecapMedia }) {
  return (
    <View style={styles.frame}>
      {media.media_type === "image" ? (
        <Image contentFit="contain" source={{ uri: media.signed_url }} style={styles.media} transition={160} />
      ) : (
        <RecapVideo media={media} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { aspectRatio: 16 / 10, backgroundColor: "#050509", overflow: "hidden", width: "100%" },
  media: { height: "100%", width: "100%" },
});
