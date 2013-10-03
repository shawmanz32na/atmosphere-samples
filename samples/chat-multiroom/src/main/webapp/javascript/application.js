$(function () {
    "use strict";

    var header = $('#header');
    var rooms = $('#rooms');
    var content = $('#content');
    var users = $('#users');
    var input = $('#input');
    var status = $('#status');
    var myName = false;
    var author = null;
    var logged = false;
    var socket = atmosphere;
    var subSocket;
    var transport = 'streaming';
    var fallbackTransport = 'long-polling';
    var connected = false;
    var uuid = 0;
	var reconnect = false;
	var chatroomName; //Used only when switching chatrooms

    header.html($('<h3>', { text: 'Atmosphere Chat. Default transport is ' + transport + ', fallback is ' + fallbackTransport }));
    status.text('Choose chatroom:');
    input.removeAttr('disabled').focus();

    input.keydown(function (e) {
        if (e.keyCode === 13) {
			//Grab the value in the input text box
            var msg = $(this).val();

			//Clear the input box
            $(this).val('');
			
            if (!connected) {
                connected = true;
                connect(msg);
                return;
            }

            // First message received is always the author's name
            if (author == null) {
                author = msg;
            }

            input.removeAttr('disabled').focus();
            // Check for custom actions (e.g. private message, exit room, etc.)
            if (msg.indexOf(":") !== -1) {
				var commands = msg.split(":");
				if (commands[0] === "switch") { // "switch:[chatroom_name]" will switch rooms
					// If you call this method, the new atmosphere connection will be stuck
					// in a "pending" status. This will leave your application in an "in-between"
					// state. Atmosphere will resort to long-polling, but will not resend the request.
					// When this "pending" connection finally gets closed by the server,
					// atmosphere will resend the request, and the command will be processed. By then,
					// though, that request won't make sense, and you'll get unexpected results.
					leaveChatRoom();
					//Join new Chatroom while the old one is still closing
					reconnect = true;
					chatroomName = commands[1];
					joinNewChatRoom();
					getRoomText();
				} else if (commands[0] === "exit") { // "exit:" will leave the chatroom
					// If you call this method, the pop-up caused by 'getRoomText()' will never appear,
					// because that HTTP request will get stuck in a "pending" state.
					leaveChatRoom();
					getRoomText();
				} else { // "[user]:[message]" will send private message to [user]
					subSocket.push(atmosphere.util.stringifyJSON({ user: commands[0], message: commands[1]}));
				}
            } else {
                subSocket.push(atmosphere.util.stringifyJSON({ author: author, message: msg, uuid: uuid }));
            }

            if (myName === false) {
                myName = msg;
            }
        }
    });

    function connect(chatroom) {
        // We are now ready to cut the request
        var request = { url: document.location.toString() + 'chat/' + chatroom,
            contentType: "application/json",
            logLevel: 'debug',
            transport: transport,
            trackMessageLength: true,
            reconnectInterval: 5000,
            fallbackTransport: fallbackTransport};

        request.onOpen = function (response) {
            content.html($('<p>', { text: 'Atmosphere connected using ' + response.transport }));
            if ((author == null) && (myName === false)) {
				status.text('Choose name:');
			}
            input.removeAttr('disabled').focus();
            transport = response.transport;
            uuid = response.request.uuid;
        };

        request.onReopen = function (response) {
            content.html($('<p>', { text: 'Atmosphere re-connected using ' + response.transport }));
            input.removeAttr('disabled').focus();
        };

        request.onMessage = function (response) {

            var message = response.responseBody;
            try {
                var json = atmosphere.util.parseJSON(message);
            } catch (e) {
                console.log('This doesn\'t look like a valid JSON: ', message);
                return;
            }

            input.removeAttr('disabled').focus();
            if (json.rooms) {
                rooms.html($('<h2>', { text: 'Current room: ' + chatroom}));

                var r = 'Available rooms: ';
                for (var i = 0; i < json.rooms.length; i++) {
                    r += json.rooms[i].split("/")[2] + "  ";
                }
                rooms.append($('<h3>', { text: r }))
            }

            if (json.users) {
                var r = 'Connected users: ';
                for (var i = 0; i < json.users.length; i++) {
                    r += json.users[i] + "  ";
                }
                users.html($('<h3>', { text: r }))
            }

            if (json.author) {
                if (!logged && myName) {
                    logged = true;
                    status.text(myName + ': ').css('color', 'blue');
                } else {
                    var me = json.author == author;
                    var date = typeof(json.time) == 'string' ? parseInt(json.time) : json.time;
                    addMessage(json.author, json.message, me ? 'blue' : 'black', new Date(date));
                }
            }
        };

        request.onClose = function (response) {
            subSocket.push(atmosphere.util.stringifyJSON({ author: author, message: 'disconnecting' }));
			content.html($('<p>', { text: 'atmosphere disconnected!' }));
			joinNewChatRoom();
        };

        request.onError = function (response) {
            content.html($('<p>', { text: 'Sorry, but there\'s some problem with your '
                + 'socket or the server is down' }));
            logged = false;
        };

        request.onReconnect = function (request, response) {
            content.html($('<p>', { text: 'Connection lost, trying to reconnect. Trying to reconnect ' + request.reconnectInterval}));
            input.attr('disabled', 'disabled');
        };

        subSocket = socket.subscribe(request);
		
		//Grab a file from the server to simulate more info and commands incoming
		getRoomText();
    }

    function addMessage(author, message, color, datetime) {
        content.append('<p><span style="color:' + color + '">' + author + '</span> @ ' + +(datetime.getHours() < 10 ? '0' + datetime.getHours() : datetime.getHours()) + ':'
            + (datetime.getMinutes() < 10 ? '0' + datetime.getMinutes() : datetime.getMinutes())
            + ': ' + message + '</p>');
    }
	
	// Unsubscribes from the current connection, and resets the global variables to reflect
	// that status
	function leaveChatRoom() {
		socket.unsubscribe();
		connected = false;
		author = null;
		myName = false;
		status.text('Choose chatroom:');
	}
	
	// Subscribes to the chatroom as specified in 'chatroomName'.
	// Only attempts subscription if the 'reconnect' flag has been set, and the 'chatroomName' is not null.
	function joinNewChatRoom() {
		if (reconnect === true && chatroomName !== null) {
			connect(chatroomName);
			reconnect == false;
			chatroomName = null;
		}
	}
	
	// JS AJAX Call to retrieve text file from server.
	// We append a val parameter to the request string to make sure that the browser/webserver
	// can't cache the request. Once the request is received, a pop-up will display with the
	// contents of the file.
	function getRoomText() {
		var xmlhttp;
		xmlhttp = new XMLHttpRequest(); //code for IE7+, Firefox, Chrome, Opera, Safari
		xmlhttp.onreadystatechange = function() {
			if (xmlhttp.readyState == 4 && xmlhttp.status == 200) {
				alert(xmlhttp.responseText);
			}
		}
		xmlhttp.open("GET","room_info_testroom.txt?val=" + new Date().getTime(),true);
		xmlhttp.send();
	}
});
