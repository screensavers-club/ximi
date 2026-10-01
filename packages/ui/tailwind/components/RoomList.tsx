import { motion, AnimatePresence } from "framer-motion";
import { FaFaceSmile } from "react-icons/fa6";

export const RoomList: React.FC<{
  rooms?: { name: string }[];
  onClick?: (roomName: string) => void;
}> = ({ rooms = [], onClick = () => {} }) => {
  return (
    <div className="w-full text-center">
      {rooms.length < 1 ? (
        <div className="pt-[20vh] flex flex-col items-center">
          <FaFaceSmile size={60} />
          <h1 className="mt-4 text-2xl">No rooms online.</h1>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <AnimatePresence>
            {[...rooms]
              .sort((a, b) => (a.name > b.name ? 1 : -1))
              .map((r) => (
                <motion.div
                  className="w-full bg-bg border border-brand rounded-md [&:hover]:border-text cursor-pointer [&:hover]:bg-brand/80 p-2 text-xl flex items-center justify-center transition"
                  key={r.name}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "60px", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  onClick={() => {
                    onClick(r.name);
                  }}
                >
                  {r.name}
                </motion.div>
              ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};
