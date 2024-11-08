// api.js
class API {
    constructor() {
        this.baseUrl = 'https://neutral-marylou-slimeapp-2e3dcce0.koyeb.app/api'; // Замените на ваш URL
    }

    async getUserData(userId) {
        try {
            const response = await fetch(`${this.baseUrl}/users/${userId}`);
            return await response.json();
        } catch (error) {
            console.error('Error fetching user data:', error);
            throw error;
        }
    }

    async updateUserData(userId, data) {
        try {
            const response = await fetch(`${this.baseUrl}/users/${userId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });
            return await response.json();
        } catch (error) {
            console.error('Error updating user data:', error);
            throw error;
        }
    }

    async startFarming(userId) {
        try {
            const response = await fetch(`${this.baseUrl}/users/${userId}/start-farming`, {
                method: 'POST'
            });
            return await response.json();
        } catch (error) {
            console.error('Error starting farming:', error);
            throw error;
        }
    }

    async endFarming(userId, earnedAmount, earnedXp) {
        try {
            const response = await fetch(`${this.baseUrl}/users/${userId}/end-farming`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ earnedAmount, earnedXp })
            });
            return await response.json();
        } catch (error) {
            console.error('Error ending farming:', error);
            throw error;
        }
    }
}
