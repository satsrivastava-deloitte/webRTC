import React, { useState, useRef, useEffect, useCallback } from 'react';
import io from 'socket.io-client';
import Video from './Components/Video';
import { WebRTCUser } from './types';

// const pc_config = {
// 	iceServers: [
// 		// {
// 		//   urls: 'stun:[STUN_IP]:[PORT]',
// 		//   'credentials': '[YOR CREDENTIALS]',
// 		//   'username': '[USERNAME]'
// 		// },
// 		{
// 			urls: 'stun:stun.l.google.com:19302',
// 		},
// 	],
// };

const SOCKET_SERVER_URL = 'http://localhost:8000';
const TURN_SERVER_URL = 'localhost:3478';
const TURN_SERVER_USERNAME = 'username';
const TURN_SERVER_CREDENTIAL = 'credential';

const pc_config = {
	iceServers: [
	  {
		urls: 'turn:' + TURN_SERVER_URL + '?transport=tcp',
		username: TURN_SERVER_USERNAME,
		credential: TURN_SERVER_CREDENTIAL
	  },
	  {
		urls: 'turn:' + TURN_SERVER_URL + '?transport=udp',
		username: TURN_SERVER_USERNAME,
		credential: TURN_SERVER_CREDENTIAL
	  }
	]
  };

const App = () => {
	const socketRef = useRef<SocketIOClient.Socket>();
	const pcsRef = useRef<{ [socketId: string]: RTCPeerConnection }>({});
	const localVideoRef = useRef<HTMLVideoElement>(null);
	const localStreamRef = useRef<MediaStream>();
	const [users, setUsers] = useState<WebRTCUser[]>([]);
	const [userCount,setuserCount]=useState(0);

// Signaling methods
//let socket = io(SOCKET_SERVER_URL, { autoConnect: false });

	const getLocalStream = useCallback(async () => {
		try {
			const localStream = await navigator.mediaDevices.getUserMedia({
				audio: true,
				video: {
					width: 240,
					height: 240,
				},
			});
			localStreamRef.current = localStream;
			if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
			if (!socketRef.current) return;
			socketRef.current.emit('join_room', {
				room: '1234',
				email: 'sample@naver.com',
			});
		} catch (e) {
			console.log(`getUserMedia error: ${e}`);
		}
	}, []);

	const createPeerConnection = useCallback((socketID: string, email: string) => {
		try {
			const pc = new RTCPeerConnection(pc_config);

			pc.onicecandidate = (e) => {
				if (!(socketRef.current && e.candidate)) return;
				console.log('onicecandidate');
				socketRef.current.emit('candidate', {
					candidate: e.candidate,
					candidateSendID: socketRef.current.id,
					candidateReceiveID: socketID,
				});
			};

			pc.oniceconnectionstatechange = (e) => {
				console.log(e);
			};

			pc.ontrack = (e) => {
				console.log('ontrack success',users);
				setUsers((oldUsers) =>
					oldUsers
						.filter((user) => user.id !== socketID)
						.concat({
							id: socketID,
							email,
							stream: e.streams[0],
						}),
				);
			};

			if (localStreamRef.current) {
				console.log('localstream add');
				localStreamRef.current.getTracks().forEach((track) => {
					if (!localStreamRef.current) return;
					pc.addTrack(track, localStreamRef.current);
				});
			} else {
				console.log('no local stream');
			}

			return pc;
		} catch (e) {
			console.error(e);
			return undefined;
		}
	}, []);

	useEffect(() => {
		socketRef.current = io.connect(SOCKET_SERVER_URL);
		getLocalStream();

		socketRef.current.on('all_users', (allUsers: Array<{ id: string; email: string }>) => {
			setuserCount(userCount+1);
			allUsers.forEach(async (user) => {
				if (!localStreamRef.current) return;
				const pc = createPeerConnection(user.id, user.email);
				if (!(pc && socketRef.current)) return;
				pcsRef.current = { ...pcsRef.current, [user.id]: pc };
				try {
					const localSdp = await pc.createOffer({
						offerToReceiveAudio: true,
						offerToReceiveVideo: true,
					});
					console.log(allUsers);
					console.log('create offer success');
					await pc.setLocalDescription(new RTCSessionDescription(localSdp));
					socketRef.current.emit('offer', {
						sdp: localSdp,
						offerSendID: socketRef.current.id,
						offerSendEmail: 'offerSendSample@sample.com',
						offerReceiveID: user.id,
					});
				} catch (e) {
					console.error(e);
				}
			});
			
		});
		console.log(userCount,"no of people added");

		socketRef.current.on(
			'getOffer',
			async (data: {
				sdp: RTCSessionDescription;
				offerSendID: string;
				offerSendEmail: string;
			}) => {
				const { sdp, offerSendID, offerSendEmail } = data;
				console.log('get offer');
				if (!localStreamRef.current) return;
				const pc = createPeerConnection(offerSendID, offerSendEmail);
				if (!(pc && socketRef.current)) return;
				pcsRef.current = { ...pcsRef.current, [offerSendID]: pc };
				try {
					await pc.setRemoteDescription(new RTCSessionDescription(sdp));
					console.log('answer set remote description success');
					const localSdp = await pc.createAnswer({
						offerToReceiveVideo: true,
						offerToReceiveAudio: true,
					});
					await pc.setLocalDescription(new RTCSessionDescription(localSdp));
					socketRef.current.emit('answer', {
						sdp: localSdp,
						answerSendID: socketRef.current.id,
						answerReceiveID: offerSendID,
					});
				} catch (e) {
					console.error(e);
				}
			},
		);

		socketRef.current.on(
			'getAnswer',
			(data: { sdp: RTCSessionDescription; answerSendID: string }) => {
				const { sdp, answerSendID } = data;
				console.log('get answer');
				const pc: RTCPeerConnection = pcsRef.current[answerSendID];
				if (!pc) return;
				pc.setRemoteDescription(new RTCSessionDescription(sdp));
			},
		);

		socketRef.current.on(
			'getCandidate',
			async (data: { candidate: RTCIceCandidateInit; candidateSendID: string }) => {
				console.log('get candidate',data);
				const pc: RTCPeerConnection = pcsRef.current[data.candidateSendID];
				if (!pc) return;
				await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
				console.log('candidate add success',users);
			},
		);

		socketRef.current.on('user_exit', (data: { id: string }) => {
			console.log("user_exit: ",data);
			if (!pcsRef.current[data.id]) return;
			pcsRef.current[data.id].close();
			delete pcsRef.current[data.id];
			setUsers((oldUsers) => oldUsers.filter((user) => user.id !== data.id));
		});

		return () => {
			console.log("user_exit: ",socketRef.current, pcsRef.current);
			if (socketRef.current) {
				socketRef.current.disconnect();
			}
			users.forEach((user) => {
				if (!pcsRef.current[user.id]) return;
				pcsRef.current[user.id].close();
				delete pcsRef.current[user.id];
			});
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [createPeerConnection, getLocalStream]);

	return (
		<div>
			<video
				style={{
					width: 240,
					height: 240,
					margin: 5,
					backgroundColor: 'black',
				}}
				muted
				ref={localVideoRef}
				autoPlay
			/>{console.log(users,"new people")}
			{users.map((user, index) => (
				<Video key={index} email={user.email} stream={user.stream} />
			))}
		</div>
	);
};

export default App;
